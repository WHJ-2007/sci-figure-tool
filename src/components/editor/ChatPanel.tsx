"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadSettings } from "@/lib/settings";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { AgentEvent } from "@/lib/ai/agent";
import type { AIMode } from "@/lib/ai/prompt";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

type AIChatMode = "auto" | AIMode;
const MODE_OPTIONS: { value: AIChatMode; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "sci", label: "科研绘图" },
  { value: "mindmap", label: "思维导图" },
  { value: "chart", label: "图表制作" },
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>("");
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const setActivity = useCanvasStore((s) => s.setActivity);
  const setGenerating = useCanvasStore((s) => s.setGenerating);
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const [mode, setMode] = useState<AIChatMode>("auto");

  // 模式选择按画布持久化：切换画布/刷新恢复
  useEffect(() => {
    const saved = localStorage.getItem(`chartMode-${currentProjectId}`);
    setMode(saved === "sci" || saved === "mindmap" || saved === "chart" ? saved : "auto");
  }, [currentProjectId]);

  const selectMode = (m: AIChatMode) => {
    setMode(m);
    localStorage.setItem(`chartMode-${currentProjectId}`, m);
  };

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    // 守卫用 getState()：避免订阅闭包在极端时序下被旧请求的 finally 误解锁
    if (!text || useCanvasStore.getState().isGenerating) return;
    const s = useCanvasStore.getState();
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
          mode,
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
      // 行缓冲：网络分块可能把一行 JSON 拆成多段，必须先拼够 "\n" 再解析
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line) {
            const ev = JSON.parse(line) as AgentEvent;
            if (ev.type === "progress") {
              const items = ev.activity ?? [];
              if (items.length) useCanvasStore.setState((s) => ({ activity: [...s.activity, ...items] }));
            }
            else if (ev.type === "new-canvas") {
              // AI 新建画布：创建并切换到新项目，撤销基线重置为新画布空态
              useCanvasStore.getState().createProject();
              baseline = structuredClone(useCanvasStore.getState().doc);
            } else if (ev.type === "snapshot") {
              useCanvasStore.getState().applyAISnapshot(ev.canvas);
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
            } else if (ev.type === "error") setError(ev.message);
          }
          nl = buf.indexOf("\n");
        }
      }
      if (finalDoc) {
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

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
        <span className="text-sm font-semibold text-gray-700">AI 助手</span>
        <button onClick={() => setOpen(!open)} className="lift rounded-lg px-2 py-0.5 text-xs text-gray-500 hover:bg-white/60">{open ? "收起" : "展开"}</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3.5 text-sm" ref={bodyRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`msg-in max-w-[85%] rounded-2xl border px-3.5 py-2 shadow-sm backdrop-blur-md ${
              m.role === "user"
                ? "ml-auto border-blue-400/40 bg-blue-500/75 text-white"
                : "border-white/60 bg-white/75 text-gray-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {error && <div className="rounded-xl border border-red-200/60 bg-red-100/40 p-2 text-xs text-red-700 backdrop-blur-md">{error}</div>}
      </div>
      <div className="border-t border-white/50 p-3">
        <div className="mb-2 flex rounded-full border border-white/60 bg-white/50 p-0.5 shadow-sm backdrop-blur-md">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              onClick={() => selectMode(m.value)}
              aria-pressed={mode === m.value}
              className={`lift flex-1 rounded-full px-1 py-1 text-xs ${
                mode === m.value ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:bg-white/70"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="描述你想画的图…（回车发送）"
          rows={2}
          className="w-full resize-none rounded-xl border border-white/60 bg-white/60 px-3 py-2 text-sm text-gray-700 shadow-sm outline-none backdrop-blur-md focus:border-blue-400"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs text-gray-500/90">支持一键生成与对话修改</span>
          <button
            onClick={send}
            disabled={isGenerating || !input.trim()}
            className="lift rounded-xl bg-blue-600/85 px-3.5 py-1.5 text-sm text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {isGenerating ? "生成中…" : "一键生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
