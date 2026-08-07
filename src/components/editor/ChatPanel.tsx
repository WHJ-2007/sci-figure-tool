"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadSettings } from "@/lib/settings";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { AgentEvent } from "@/lib/ai/agent";
import type { AIMode } from "@/lib/ai/prompt";
import ConfirmDialog from "./ConfirmDialog";
import GenerationToast from "./GenerationToast";

interface Msg {
  role: "user" | "assistant";
  content: string;
  // 跨画布引用：AI 调用 readCanvas 读取了其他画布时打标，气泡下方显示「引用了…画布」图标
  referenced?: string;
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
  // A3 提问澄清：AI 的 askUser 问题（问题已作为 assistant 消息入 messages，此状态驱动输入框提示/聚焦/副标）
  const [waitingAnswer, setWaitingAnswer] = useState<string | null>(null);
  // A9 可点击选项：当前等待回答的问题的可点击选项（点选即作为回答发送）
  const [questionOptions, setQuestionOptions] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A5 画布守卫：记录本轮请求对应的画布 id，生成中切换画布 → 后续事件全部丢弃
  const requestProjectIdRef = useRef<string | null>(null);
  // AI 发起的画布切换（new-canvas 事件）：不当作"用户切画布"，对话会话保留
  const aiCanvasSwitchRef = useRef(false);
  // A7 对话长期记忆：消息按画布持久化（localStorage），刷新/关页/切换画布后恢复
  const chatKey = (pid: string) => `chatMessages-${pid}`;
  const messagesRef = useRef<Msg[]>([]);
  const lastProjectRef = useRef<string | null>(null);
  // 本轮 AI 引用的其他画布名（referenced 事件收集，追加 assistant 消息时打标）
  const referencedRef = useRef<string[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // 消息变化即保存到当前画布的存档（仅当消息确实属于当前画布）；同时写回当前对话并持久化（刷新恢复）
  useEffect(() => {
    if (lastProjectRef.current !== currentProjectId) return;
    localStorage.setItem(chatKey(currentProjectId), JSON.stringify(messages));
    threadsRef.current = threadsRef.current.map((t) => (t.id === activeThreadIdRef.current ? { ...t, messages } : t));
    setThreads([...threadsRef.current]);
    persistThreads(currentProjectId);
  }, [messages, currentProjectId]);

  // A8 单画布多对话：每个画布有多个对话（threads），标签页切换/新建/删除/右键重命名；
  // 持久化到 chatThreads-{projectId}（兼容旧 chatMessages-{projectId} 单对话格式，加载时自动迁移）
  interface Thread { id: string; name: string; messages: Msg[] }
  const threadsKey = (pid: string) => `chatThreads-${pid}`;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const threadsRef = useRef<Thread[]>([]);
  const activeThreadIdRef = useRef("");
  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);

  const persistThreads = (pid: string) => {
    localStorage.setItem(threadsKey(pid), JSON.stringify({ threads: threadsRef.current, activeId: activeThreadIdRef.current }));
  };
  // 加载画布对话：优先多对话格式，缺失则迁移旧 chatMessages 单对话（保持刷新恢复兼容）
  const loadThreadsFor = (pid: string): { threads: Thread[]; activeId: string } => {
    const validMsg = (m: unknown): m is Msg => {
      const x = m as Msg;
      return !!x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string";
    };
    try {
      const raw = localStorage.getItem(threadsKey(pid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.threads)) {
          const t = parsed.threads
            .filter((x: unknown) => { const th = x as Thread; return th && typeof th.id === "string" && Array.isArray(th.messages); })
            .map((x: Thread) => ({ id: x.id, name: typeof x.name === "string" ? x.name : "对话", messages: x.messages.filter(validMsg) }));
          const activeId = t.some((x: Thread) => x.id === parsed.activeId) ? String(parsed.activeId) : t[0]?.id ?? "";
          if (t.length > 0) return { threads: t, activeId };
        }
      }
    } catch { /* 走旧格式迁移 */ }
    let msgs: Msg[] = [];
    try {
      const raw = localStorage.getItem(chatKey(pid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) msgs = parsed.filter(validMsg);
      }
    } catch { msgs = []; }
    const t: Thread = { id: `t-${pid}-default`, name: "对话 1", messages: msgs };
    return { threads: [t], activeId: t.id };
  };

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

  // A5 画布守卫 + A7/A8 对话记忆：用户切换画布 → 保存旧画布对话、加载新画布对话（不再无脑清空）；
  // AI 的 new-canvas 事件也是同会话延续（对话保留并继续存到新画布）
  useEffect(() => {
    if (aiCanvasSwitchRef.current) {
      aiCanvasSwitchRef.current = false;
      lastProjectRef.current = currentProjectId;
      // 把当前消息写回当前对话，再持久化整组对话
      threadsRef.current = threadsRef.current.map((t) => (t.id === activeThreadIdRef.current ? { ...t, messages: messagesRef.current } : t));
      persistThreads(currentProjectId);
      localStorage.setItem(chatKey(currentProjectId), JSON.stringify(messagesRef.current));
      return;
    }
    // 切走前保存旧画布对话
    if (lastProjectRef.current && lastProjectRef.current !== currentProjectId) {
      threadsRef.current = threadsRef.current.map((t) => (t.id === activeThreadIdRef.current ? { ...t, messages: messagesRef.current } : t));
      persistThreads(lastProjectRef.current);
      localStorage.setItem(chatKey(lastProjectRef.current), JSON.stringify(messagesRef.current));
    }
    // 加载新画布已保存的对话（多对话格式优先，缺失则迁移旧单对话格式）
    const loaded = loadThreadsFor(currentProjectId);
    threadsRef.current = loaded.threads;
    activeThreadIdRef.current = loaded.activeId;
    setThreads(loaded.threads);
    setActiveThreadId(loaded.activeId);
    const msgs = loaded.threads.find((t) => t.id === loaded.activeId)?.messages ?? [];
    lastProjectRef.current = currentProjectId;
    messagesRef.current = msgs;
    setMessages(msgs);
    setInput("");
    setError("");
    setConfirmReq(null);
    setWaitingAnswer(null);
  }, [currentProjectId]);

  // 对话操作：切换 / 新建 / 删除 / 重命名（标签页）
  const switchThread = (id: string) => {
    if (id === activeThreadIdRef.current) return;
    threadsRef.current = threadsRef.current.map((t) => (t.id === activeThreadIdRef.current ? { ...t, messages: messagesRef.current } : t));
    activeThreadIdRef.current = id;
    setActiveThreadId(id);
    const msgs = threadsRef.current.find((t) => t.id === id)?.messages ?? [];
    messagesRef.current = msgs;
    setMessages(msgs);
    setInput("");
    setError("");
    setConfirmReq(null);
    setWaitingAnswer(null);
    persistThreads(currentProjectId);
  };
  const newThread = () => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `对话 ${threadsRef.current.length + 1}`;
    threadsRef.current = threadsRef.current.map((t) => (t.id === activeThreadIdRef.current ? { ...t, messages: messagesRef.current } : t));
    threadsRef.current.push({ id, name, messages: [] });
    activeThreadIdRef.current = id;
    setThreads([...threadsRef.current]);
    setActiveThreadId(id);
    messagesRef.current = [];
    setMessages([]);
    setInput("");
    setError("");
    setConfirmReq(null);
    setWaitingAnswer(null);
    persistThreads(currentProjectId);
  };
  const deleteThread = (id: string) => {
    if (threadsRef.current.length <= 1) return; // 至少保留一个对话
    threadsRef.current = threadsRef.current.filter((t) => t.id !== id);
    setThreads([...threadsRef.current]);
    if (activeThreadIdRef.current === id) {
      const next = threadsRef.current[0];
      activeThreadIdRef.current = next.id;
      setActiveThreadId(next.id);
      messagesRef.current = next.messages;
      setMessages(next.messages);
    }
    persistThreads(currentProjectId);
  };
  const renameThread = (id: string) => {
    const t = threadsRef.current.find((x) => x.id === id);
    const name = window.prompt("对话名称", t?.name ?? "");
    if (name && name.trim()) {
      threadsRef.current = threadsRef.current.map((x) => (x.id === id ? { ...x, name: name.trim() } : x));
      setThreads([...threadsRef.current]);
      persistThreads(currentProjectId);
    }
  };

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

  // A3 提问澄清：收到问题后聚焦输入框，等待用户回答
  useEffect(() => {
    if (waitingAnswer) inputRef.current?.focus();
  }, [waitingAnswer]);

  // 主生成流程：给定完整消息列表发起 /api/chat 流式生成（send 与"确认拒绝/会话过期后自动续跑"共用）
  const runGeneration = async (next: Msg[]) => {
    if (useCanvasStore.getState().isGenerating) return;
    // 提问澄清的回答复用主流程：问题已在 messages 中，此处只追加回答，上下文完整 AI 会继续执行
    setWaitingAnswer(null);
    setQuestionOptions(null);
    referencedRef.current = [];
    const s = useCanvasStore.getState();
    requestProjectIdRef.current = s.currentProjectId;
    const settings = loadSettings();
    // 生成前画布作为撤销基线：snapshot 中间态不入栈，生成完成后整体一步 undo 回到该基线；
    // new-canvas 事件后基线重置为新画布的空态
    let baseline = structuredClone(s.doc);
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
          tavilyApiKey: settings.tavilyApiKey ?? "",
          modes: auto ? null : modes,
          // 其他画布摘要（跨画布读取/参考用，不含位图 dataURL）：AI 可引用但绝不切换画布
          canvases: useCanvasStore
            .getState()
            .projects.filter((p) => p.id !== s.currentProjectId)
            .map((p) => ({
              id: p.id,
              name: p.name,
              elements: p.doc.elements.map((e) => ({
                type: e.type,
                x: e.x,
                y: e.y,
                width: e.width,
                height: e.height,
                text: "text" in e ? (e as { text?: string }).text : undefined,
                body: "body" in e ? (e as { body?: string }).body : undefined,
                fill: e.fill,
                stroke: e.stroke,
                head: e.type === "arrow" ? (e as { head?: string }).head : undefined,
              })),
            })),
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
            } else if (ev.type === "question") {
              // A3 提问澄清：若 AI 提问前已画了元素（不应发生）则按问题优先全部丢弃——恢复生成前基线；
              // 问题作为 assistant 消息入对话，等待用户回答后走主流程继续生成
              if (lastSnapshot) useCanvasStore.getState().applyAISnapshot(baseline);
              lastSnapshot = null;
              const refs = referencedRef.current;
              referencedRef.current = [];
              setMessages((m) => [...m, { role: "assistant", content: ev.question, referenced: refs.length ? refs.join("、") : undefined }]);
              setWaitingAnswer(ev.question);
              // A9 可点击选项：AI 提供选项时渲染可点击按钮，点选即作为回答发送
              setQuestionOptions(ev.options && ev.options.length > 0 ? ev.options : null);
            } else if (ev.type === "confirm-request") {
              // 生成主体结束：把最后快照作为最终结果入历史（一步 undo 回到生成前），再弹确认框；
              // AI 文字回复先入对话（与 complete 分支的 summary 行为一致，空串不产生气泡）
              if (lastSnapshot) useCanvasStore.getState().applyAIResult(lastSnapshot, baseline);
              if (ev.summary) {
                const refs = referencedRef.current;
                referencedRef.current = [];
                setMessages((m) => [...m, { role: "assistant", content: ev.summary, referenced: refs.length ? refs.join("、") : undefined }]);
              }
              setConfirmReq({ sessionId: ev.sessionId, summary: ev.summary, pending: ev.pending });
            } else if (ev.type === "error") setError(ev.message);
            else if (ev.type === "referenced") {
              // 跨画布引用：记录画布名，追加 assistant 消息时打标（气泡下方显示「引用了…画布」）
              referencedRef.current = [...referencedRef.current, ev.canvasName];
            }
          }
          nl = buf.indexOf("\n");
        }
        if (abandoned) break;
      }
      if (abandoned) {
        setError("画布已切换，本次生成已丢弃");
      } else if (finalDoc) {
        useCanvasStore.getState().applyAIResult(finalDoc, baseline);
        if (summary) {
          const refs = referencedRef.current;
          referencedRef.current = [];
          setMessages((m) => [...m, { role: "assistant", content: summary, referenced: refs.length ? refs.join("、") : undefined }]);
        }
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

  // 用户发送：读输入框 → 追加用户消息 → 走主生成流程；仍有未解决的确认项时禁止发起新生成
  const send = async () => {
    const text = input.trim();
    if (!text || useCanvasStore.getState().isGenerating || (confirmReq && confirmReq.pending.length > 0)) return;
    await runGeneration([...messages, { role: "user" as const, content: text }]);
  };

  // A9 可点击选项：点选选项即作为回答发送（问题已在 messages 中，追加选项文本后继续生成）
  const answerOption = async (opt: string) => {
    if (useCanvasStore.getState().isGenerating || (confirmReq && confirmReq.pending.length > 0)) return;
    await runGeneration([...messages, { role: "user" as const, content: opt }]);
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
        // 会话过期(404)等失败：不能只报错死路——通知 AI 让它可以继续处理（重新发起或询问用户），否则用户只能手动重发
        setError(data.error ?? `确认失败 (${res.status})`);
        setConfirmReq(null);
        const notice: Msg = { role: "user", content: `（系统提示：确认会话已失效（${data.error ?? "会话过期"}），之前请求的操作未能执行。请根据情况重新发起操作，或询问用户希望如何处理。）` };
        const next = [...messages, notice];
        setMessages(next);
        void runGeneration(next);
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
      // 用户拒绝（不允许）→ 让 AI 知道并继续：追加系统提示、自动续跑，AI 可据此调整方案或继续向用户提问，
      // 而不是直接关闭 AI 会话（"所有的请求如果不允许，应该让 AI 知道"）
      if (!approved) {
        const notice: Msg = { role: "user", content: `（系统提示：用户拒绝了操作「${desc}」。请根据情况调整方案：可以询问用户希望如何处理，或改用其他替代方案；不要重复执行已被拒绝的操作。）` };
        const next = [...messages, { role: "assistant" as const, content: `已取消：${desc}` }, notice];
        setMessages(next);
        void runGeneration(next);
      }
    } catch (err) {
      setError("确认失败：" + String(err));
      setConfirmReq(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      {/* 对话标签页：多对话切换 / 新建 / 删除 / 右键重命名（单画布内） */}
      <div className="border-b border-white/50 px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {threads.map((t) => {
            const active = t.id === activeThreadId;
            return (
              <div
                key={t.id}
                data-testid="chat-thread-tab"
                data-active={active ? "true" : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  renameThread(t.id);
                }}
                className={`flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs ${
                  active ? "border-blue-400 bg-blue-600 text-white" : "border-white/60 bg-white/40 text-gray-600 hover:bg-white/70"
                }`}
              >
                <button
                  title={`切换到 ${t.name}`}
                  onClick={() => switchThread(t.id)}
                  className={`lift max-w-[6rem] truncate ${active ? "" : "hover:text-blue-600"}`}
                >
                  {t.name}
                </button>
                <button
                  title={`删除对话 ${t.name}`}
                  onClick={() => deleteThread(t.id)}
                  className="lift flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs leading-none hover:bg-red-500 hover:text-white"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            title="新建对话"
            onClick={newThread}
            className="lift flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-white/60 bg-white/40 text-gray-600 hover:bg-white/70"
          >
            +
          </button>
        </div>
      </div>
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
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 pb-12 pt-3.5 text-sm" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className="group/msg relative">
            <div className={`flex max-w-[85%] ${m.role === "user" ? "ml-auto flex-col items-end" : "flex-col items-start"}`}>
              <div
                className={`msg-in w-fit border px-3.5 py-2 backdrop-blur-md ${
                  m.role === "user"
                    ? "rounded-[14px_14px_4px_14px] border-blue-400/40 bg-blue-500/85 text-white shadow-md"
                    : "rounded-[14px_14px_14px_4px] border-white/60 bg-white/80 text-gray-800 shadow-md"
                }`}
              >
                {m.content}
                {/* 跨画布引用图标：AI 读取了其他画布内容（readCanvas）时显示，指明引用来源 */}
                {m.referenced && (
                  <div
                    data-testid="canvas-referenced"
                    className="mt-1.5 flex w-fit items-center gap-1 rounded-md bg-amber-100/70 px-1.5 py-0.5 text-[10px] text-amber-700"
                    title={`AI 引用了其他画布的内容：${m.referenced}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M3 9h18M9 21V9" />
                    </svg>
                    引用了「{m.referenced}」画布
                  </div>
                )}
                {m.role === "assistant" && waitingAnswer && m.content === waitingAnswer && (
                  <div data-testid="waiting-answer" className="mt-1 text-xs text-blue-600">等待你的回答…</div>
                )}
                {/* A9 可点击选项：AI 提问带选项时渲染可点击按钮，点选即作为回答发送（玻璃胶囊 + 点击图标） */}
                {m.role === "assistant" && waitingAnswer && m.content === waitingAnswer && questionOptions && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="question-options">
                    {questionOptions.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => answerOption(opt)}
                        className="lift group/opt flex items-center gap-1.5 rounded-full border border-blue-300/60 bg-gradient-to-b from-white/95 to-blue-50/90 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm backdrop-blur-md transition-all hover:border-blue-400 hover:from-blue-50 hover:to-blue-100 hover:shadow-md active:scale-95"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-60 transition-transform group-hover/opt:scale-110">
                          <path d="M22 2L11 13" />
                          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 复制按钮：绝对定位于气泡下方间隙（不占文档流，显示时也不挤开后续对话）。
                  hover 保持：鼠标从气泡移向按钮的路径上（含气泡到按钮的 2px 间隙），
                  靠按钮自身 hover + 向上延伸的透明热区（before）不闪隐，到达即点中 */}
              <button
                title="复制"
                aria-label="复制消息"
                onClick={() => {
                  navigator.clipboard?.writeText(m.content).catch(() => {});
                }}
                className={`lift absolute top-full mt-0.5 hidden h-5 items-center gap-1 rounded-full px-2 text-[10px] text-gray-500 hover:bg-white/80 group-hover/msg:flex hover:flex before:pointer-events-none before:absolute before:-top-1.5 before:left-0 before:right-0 before:bottom-0 before:content-[''] ${
                  m.role === "user" ? "right-0" : "left-0"
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                复制
              </button>
            </div>
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
      {/* AI 活动气泡：位于输入框上方（弹出/关闭动画），取代左下角气泡 */}
      <div className="px-3 pt-2">
        <GenerationToast />
      </div>
      <div className="border-t border-white/50 p-3">
        <textarea
          id="chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={waitingAnswer ? "回答后继续生成…" : "描述你想画的图…（回车发送）"}
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
