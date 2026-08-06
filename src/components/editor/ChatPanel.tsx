"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadSettings } from "@/lib/settings";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { AgentEvent } from "@/lib/ai/agent";
import type { AIMode } from "@/lib/ai/prompt";
import ConfirmDialog from "./ConfirmDialog";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

// 确认流事件：/api/chat/confirm 回发的二次流（AgentEvent 联合类型不含 confirm-done）
type ConfirmEvent =
  | { type: "new-canvas" }
  | { type: "snapshot"; canvas: CanvasDocument; touched: string[] }
  | { type: "confirm-done"; results: { id: string; description: string; approved: boolean }[] };

const MODE_OPTIONS: { value: AIMode; label: string }[] = [
  { value: "sci", label: "科研绘图" },
  { value: "mindmap", label: "思维导图" },
  { value: "chart", label: "图表制作" },
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const setActivity = useCanvasStore((s) => s.setActivity);
  const setGenerating = useCanvasStore((s) => s.setGenerating);
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const [auto, setAuto] = useState(true);
  const [modes, setModes] = useState<AIMode[]>([]);
  const [confirmReq, setConfirmReq] = useState<{ sessionId: string; summary: string; pending: { id: string; description: string }[] } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // A5 画布守卫：记录本轮请求对应的画布 id，生成中切换画布 → 后续事件全部丢弃
  const requestProjectIdRef = useRef<string | null>(null);
  // AI 发起的画布切换（new-canvas 事件）：不当作"用户切画布"，对话会话保留
  const aiCanvasSwitchRef = useRef(false);

  // 模式选择按画布持久化：切换画布/刷新恢复（新格式 JSON 数组；旧格式字符串 → 单模式；自动 = "auto"）
  useEffect(() => {
    const saved = localStorage.getItem(`chartMode-${currentProjectId}`);
    if (!saved) { setAuto(true); setModes([]); return; }
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        const valid = arr.filter((m): m is AIMode => m === "sci" || m === "mindmap" || m === "chart");
        if (valid.length === arr.length && valid.length > 0) { setAuto(false); setModes(valid); return; }
      }
    } catch { /* 旧格式字符串走下面 */ }
    if (saved === "sci" || saved === "mindmap" || saved === "chart") { setAuto(false); setModes([saved]); return; }
    setAuto(true);
    setModes([]);
  }, [currentProjectId]);

  // A5 画布守卫：用户切换画布 → 清空对话会话（消息/输入/错误/确认框）；
  // AI 的 new-canvas 事件也会改 currentProjectId，但那是同一会话的延续，不清空
  useEffect(() => {
    if (aiCanvasSwitchRef.current) {
      aiCanvasSwitchRef.current = false;
      return;
    }
    setMessages([]);
    setInput("");
    setError("");
    setConfirmReq(null);
  }, [currentProjectId]);

  const selectAuto = () => {
    setAuto(true);
    setModes([]);
    localStorage.setItem(`chartMode-${currentProjectId}`, "auto");
  };

  const selectMode = (m: AIMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    // 全部具体模式取消后回到自动（与刷新恢复语义一致：auto 状态统一持久化 "auto"）
    const isAuto = next.length === 0;
    setAuto(isAuto);
    setModes(next);
    localStorage.setItem(`chartMode-${currentProjectId}`, isAuto ? "auto" : JSON.stringify(next));
  };

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    // 守卫用 getState()：避免订阅闭包在极端时序下被旧请求的 finally 误解锁；
    // 仍有未解决的确认项时禁止发起新生成，避免覆盖丢弃；pending 清空后 confirmReq 会被置 null，
    // 但保险起见同时校验 pending.length（防残留真值死锁聊天）
    if (!text || useCanvasStore.getState().isGenerating || (confirmReq && confirmReq.pending.length > 0)) return;
    const s = useCanvasStore.getState();
    requestProjectIdRef.current = s.currentProjectId;
    const settings = loadSettings();
    // 生成前画布作为撤销基线：snapshot 中间态不入栈，生成完成后整体一步 undo 回到该基线；
    // new-canvas 事件后基线重置为新画布的空态
    let baseline = structuredClone(s.doc);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setActivity([]);
    setError("");
    setGenerating(true);
    // 生成前基线：基线内元素允许被 AI 快照合并替换；基线外且未被 AI 触碰的本地元素保留
    useCanvasStore.getState().setAiBaseline(s.doc.elements.map((e) => e.id));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          canvas: s.doc as CanvasDocument,
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
          model: settings.model,
          modes: auto ? null : modes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `请求失败 (${res.status})`);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let finalDoc: CanvasDocument | null = null;
      let summary = "";
      // 最后一张快照：confirm-request 时作为"生成主体结果"入历史（一步 undo 回到生成前）
      let lastSnapshot: CanvasDocument | null = null;
      // 行缓冲：网络分块可能把一行 JSON 拆成多段，必须先拼够 "\n" 再解析
      let buf = "";
      let abandoned = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line) {
            // A5 画布守卫：生成中切到其他画布 → 丢弃本轮全部事件（new-canvas 无例外，切换后到达的一样丢弃）
            if (useCanvasStore.getState().currentProjectId !== requestProjectIdRef.current) {
              abandoned = true;
              break;
            }
            const ev = JSON.parse(line) as AgentEvent;
            if (ev.type === "progress") {
              const items = ev.activity ?? [];
              if (items.length) useCanvasStore.setState((s) => ({ activity: [...s.activity, ...items] }));
            }
            else if (ev.type === "new-canvas") {
              // AI 新建画布：创建并切换到新项目，撤销基线重置为新画布空态；
              // 本请求跟随新画布继续（刷新守卫基准，否则后续事件全部被误丢弃）
              useCanvasStore.getState().createProject();
              requestProjectIdRef.current = useCanvasStore.getState().currentProjectId;
              aiCanvasSwitchRef.current = true;
              baseline = structuredClone(useCanvasStore.getState().doc);
            } else if (ev.type === "snapshot") {
              useCanvasStore.getState().applyAISnapshot(ev.canvas);
              lastSnapshot = ev.canvas;
              // 累积本轮 AI 触碰的元素 id：前端锁定（不可选中/拖动）+ 快照合并排除（AI 可删除自己的元素）
              const touched = ev.touched ?? [];
              if (touched.length) {
                const touchedSet = new Set(touched);
                useCanvasStore.setState((st) => ({
                  aiLockedIds: [...new Set([...st.aiLockedIds, ...touched])],
                  // 锁定的元素同步剔出选区：残留锁定元素会被多选拖动/Delete/属性面板误伤
                  selection: st.selection.filter((id) => !touchedSet.has(id)),
                }));
              }
            } else if (ev.type === "complete") {
              finalDoc = ev.canvas;
              summary = ev.summary ?? "";
            } else if (ev.type === "confirm-request") {
              // 生成主体结束：把最后快照作为最终结果入历史（一步 undo 回到生成前），再弹确认框；
              // AI 文字回复先入对话（与 complete 分支的 summary 行为一致，空串不产生气泡）
              if (lastSnapshot) useCanvasStore.getState().applyAIResult(lastSnapshot, baseline);
              if (ev.summary) setMessages((m) => [...m, { role: "assistant", content: ev.summary }]);
              setConfirmReq({ sessionId: ev.sessionId, summary: ev.summary, pending: ev.pending });
            } else if (ev.type === "error") setError(ev.message);
          }
          nl = buf.indexOf("\n");
        }
        if (abandoned) break;
      }
      if (abandoned) {
        setError("画布已切换，本次生成已丢弃");
      } else if (finalDoc) {
        useCanvasStore.getState().applyAIResult(finalDoc, baseline);
        if (summary) setMessages((m) => [...m, { role: "assistant", content: summary }]);
      }
    } catch (err) {
      setError("生成中断：" + String(err));
    } finally {
      // 生成结束：解除全部锁定与基线（applyAIResult 已把最终画布合并入栈）
      useCanvasStore.getState().setAiLocked([]);
      useCanvasStore.getState().setAiBaseline([]);
      setGenerating(false);
    }
  };

  // 破坏性操作逐条确认：POST /api/chat/confirm 二次流应用已确认的操作，快照回发合并进画布
  const confirmAction = async (id: string, approved: boolean) => {
    if (!confirmReq || confirmBusy) return;
    let pid = useCanvasStore.getState().currentProjectId;
    setConfirmBusy(true);
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: confirmReq.sessionId, approvals: [{ id, approved }] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `确认失败 (${res.status})`);
        // 失败必须关闭对话框：会话过期(404)等场景下残留 confirmReq 会让用户永远卡在弹窗，且 send() 守卫永久拦截后续生成
        setConfirmReq(null);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const desc = confirmReq.pending.find((p) => p.id === id)?.description ?? "该操作";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line) {
            // A5 画布守卫：确认流期间切换画布 → 丢弃并关框
            if (useCanvasStore.getState().currentProjectId !== pid) {
              setConfirmReq(null);
              return;
            }
            const ev = JSON.parse(line) as ConfirmEvent;
            if (ev.type === "new-canvas") {
              // AI 新建画布：确认流跟随新画布继续（守卫基准同步更新，否则后续快照全被误丢弃）
              useCanvasStore.getState().createProject();
              pid = useCanvasStore.getState().currentProjectId;
              aiCanvasSwitchRef.current = true;
            }
            else if (ev.type === "snapshot") {
              // 先锁再合并：主生成结束已清空基线与锁定，被删除元素（touched）若不先锁定，
              // mergePreserved 会把它当作"用户本地新增"保留下来，删除将不生效
              const touched = ev.touched ?? [];
              if (touched.length) useCanvasStore.setState((st) => ({ aiLockedIds: [...new Set([...st.aiLockedIds, ...touched])] }));
              useCanvasStore.getState().applyAISnapshot(ev.canvas);
            }
          }
          nl = buf.indexOf("\n");
        }
      }
      setMessages((m) => [...m, { role: "assistant", content: approved ? `已确认：${desc}` : `已取消：${desc}` }]);
      useCanvasStore.getState().setAiLocked([]);
      // 过滤后无剩余挂起项则整段清空（置 null）：否则 confirmReq 残留真值会让 send() 守卫永久拦截新生成
      setConfirmReq((c) => {
        if (!c) return c;
        const rest = c.pending.filter((p) => p.id !== id);
        return rest.length > 0 ? { ...c, pending: rest } : null;
      });
    } catch (err) {
      setError("确认失败：" + String(err));
      setConfirmReq(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="border-b border-white/50 px-4 py-3">
        <span className="text-sm font-semibold text-gray-700">AI 助手</span>
      </div>
      {/* 模式条（玻璃层次第一层）：纯文字胶囊多选 */}
      <div className="border-b border-white/50 px-3 py-2">
        <div className="flex rounded-full border border-white/60 bg-white/50 p-0.5 shadow-sm backdrop-blur-md">
          <button
            onClick={selectAuto}
            aria-pressed={auto}
            className={`lift flex flex-1 items-center justify-center rounded-full px-1 py-1 text-xs ${
              auto ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:bg-white/70"
            }`}
          >
            自动
          </button>
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              onClick={() => selectMode(m.value)}
              aria-pressed={modes.includes(m.value)}
              className={`lift flex flex-1 items-center justify-center rounded-full px-1 py-1 text-xs ${
                modes.includes(m.value) ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:bg-white/70"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3.5 text-sm" ref={bodyRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`msg-in max-w-[85%] border px-3.5 py-2 backdrop-blur-md ${
              m.role === "user"
                ? "ml-auto rounded-[14px_14px_4px_14px] border-blue-400/40 bg-blue-500/85 text-white shadow-md"
                : "rounded-[14px_14px_14px_4px] border-white/60 bg-white/80 text-gray-800 shadow-md"
            }`}
          >
            {m.content}
          </div>
        ))}
        {isGenerating && messages.length > 0 && messages[messages.length - 1].role === "user" && (
          <div data-testid="ai-typing" className="msg-in flex w-fit items-center gap-1 rounded-[14px_14px_14px_4px] border border-white/60 bg-white/80 px-3.5 py-2 shadow-md backdrop-blur-md">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
          </div>
        )}
        {error && <div className="rounded-xl border border-red-200/60 bg-red-100/40 p-2 text-xs text-red-700 backdrop-blur-md">{error}</div>}
      </div>
      <div className="border-t border-white/50 p-3">
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="描述你想画的图…（回车发送）"
          rows={2}
          className="w-full resize-none rounded-xl border border-white/60 bg-white/60 px-3 py-2 text-sm text-gray-700 shadow-sm outline-none backdrop-blur-md focus:border-blue-400"
        />
        <button
          onClick={send}
          disabled={isGenerating || !input.trim()}
          className="lift mt-1.5 w-full rounded-xl bg-blue-600/85 px-3.5 py-1.5 text-sm text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isGenerating ? "生成中…" : "一键生成"}
        </button>
      </div>
      {confirmReq && confirmReq.pending.length > 0 && (
        <ConfirmDialog pending={confirmReq.pending} busy={confirmBusy} onAction={confirmAction} />
      )}
    </div>
  );
}
