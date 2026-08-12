"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadSettings } from "@/lib/settings";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { AgentEvent } from "@/lib/ai/agent";
import { ensureOtherOption, isOtherOption } from "@/lib/ai/questions";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  buildAttachmentMessage,
  formatFileSize,
  isAcceptedAttachment,
  type AttachmentSummary,
  type ParsedAttachment,
} from "@/lib/ai/attachments";

interface Msg {
  role: "user" | "assistant";
  content: string;
  displayContent?: string;
  attachments?: AttachmentSummary[];
  // 跨画布引用：AI 调用 readCanvas 读取了其他画布时打标，气泡下方显示「引用了…画布」图标
  referenced?: string;
}

// 确认流事件：/api/chat/confirm 回发的二次流（AgentEvent 联合类型不含 confirm-done）
type ConfirmEvent =
  | { type: "new-canvas" }
  | { type: "snapshot"; canvas: CanvasDocument; touched: string[] }
  | { type: "confirm-done"; results: { id: string; description: string; approved: boolean }[] };

const QUEUE_INTERRUPT_REASON = "queue-interrupt";

function queuePreviewText(text: string, attachmentNames: string[]): string {
  const source = text || `根据 ${attachmentNames.join("、")} 绘图`;
  // 预览始终从消息开头开始；换行仅折叠为空格，视觉截断交给 CSS 省略号完成。
  return source.replace(/\s+/gu, " ").trim();
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>("");
  const [pendingAttachments, setPendingAttachments] = useState<ParsedAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const setActivity = useCanvasStore((s) => s.setActivity);
  const setGenerating = useCanvasStore((s) => s.setGenerating);
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const activity = useCanvasStore((s) => s.activity);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const [confirmReq, setConfirmReq] = useState<{ sessionId: string; summary: string; pending: { id: string; description: string }[] } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // A3 提问澄清：AI 的 askUser 问题（问题已作为 assistant 消息入 messages，此状态驱动输入框提示/聚焦/副标）
  const [waitingAnswer, setWaitingAnswer] = useState<string | null>(null);
  // A9 可点击选项：当前等待回答的问题的可点击选项（点选即作为回答发送）
  const [questionOptions, setQuestionOptions] = useState<string[] | null>(null);
  const [customAnswerOpen, setCustomAnswerOpen] = useState(false);
  const [customAnswerText, setCustomAnswerText] = useState("");
  // 仅在本轮生成期间存在的实时状态气泡：不写入对话历史，不冒充 AI 的最终回答。
  const [liveStatus, setLiveStatus] = useState<{ phase: "thinking" | "drawing" | "checking"; message: string } | null>(null);
  // 真实画布同步收据：只在收到 snapshot 后递增。状态气泡据此显示“已同步”，
  // 不再在纯思考/只读检查阶段承诺画布正在变化。
  const [canvasSync, setCanvasSync] = useState<{ revision: number; elements: number }>({ revision: 0, elements: 0 });
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null);
  // 生成队列：生成中按回车发送的消息入队等待，生成结束后按序自动执行；
  // 可拖拽排序、点击置顶优先、编辑、删除；confirmReq/waitingAnswer 挂起时暂停自动执行
  interface QueueItem { id: string; text: string; attachments: ParsedAttachment[] }
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  // 队列内联编辑：editingQueueId 非空时该条目变为输入框，Enter 保存
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueText, setEditingQueueText] = useState("");
  // 拖拽排序源索引（HTML5 DnD：dragStart 记录，drop 到目标条目时重排）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A5 画布守卫：记录本轮请求对应的画布 id，生成中切换画布 → 后续事件全部丢弃
  const requestProjectIdRef = useRef<string | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  // 每次生成分配唯一代次。打断时先推进代次，旧请求即使无法立即关闭也不再有权更新 UI/画布。
  const generationIdRef = useRef(0);
  const interruptingRef = useRef(false);
  // AI 发起的画布切换（new-canvas 事件）：不当作"用户切画布"，对话会话保留
  const aiCanvasSwitchRef = useRef(false);
  // A7 对话长期记忆：消息按画布持久化（localStorage），刷新/关页/切换画布后恢复
  const chatKey = (pid: string) => `chatMessages-${pid}`;
  const messagesRef = useRef<Msg[]>([]);
  const lastProjectRef = useRef<string | null>(null);
  // 本轮 AI 引用的其他画布名（referenced 事件收集，追加 assistant 消息时打标）
  const referencedRef = useRef<string[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => () => {
    generationIdRef.current += 1;
    requestAbortRef.current?.abort("chat-panel-unmounted");
  }, []);
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
  const initialThreadId = `t-${currentProjectId}-default`;
  const [threads, setThreads] = useState<Thread[]>(() => [{ id: initialThreadId, name: "对话 1", messages: [] }]);
  const [activeThreadId, setActiveThreadId] = useState(initialThreadId);
  const threadsRef = useRef<Thread[]>(threads);
  const activeThreadIdRef = useRef(initialThreadId);
  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);

  const persistThreads = (pid: string) => {
    const json = JSON.stringify({ threads: threadsRef.current, activeId: activeThreadIdRef.current });
    localStorage.setItem(threadsKey(pid), json);
    // 长期存储兜底：把全部画布的对话（多对话 threads + 旧 messages）汇总落盘到项目 data/ 目录，
    // 保证清浏览器缓存/换浏览器后刷新仍可找回；文件是全量备份（单画布写入会丢其他画布对话）。
    // 相对 URL 在部分环境（如 jsdom）会异步 reject，必须显式 .catch 防未处理拒绝；
    // 测试环境（vitest/jsdom）跳过——chat.test 用 mockResolvedValueOnce 供 /api/chat，
    // 落盘 fetch 会抢先消耗队列导致 /api/chat 拿到 undefined
    if (process.env.NODE_ENV === "test") return;
    const all: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("chatThreads-") || k.startsWith("chatMessages-")) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) all[k] = JSON.parse(raw);
        } catch {
          // 单个损坏项跳过，不影响整体备份
        }
      }
    }
    try {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "chat", json: JSON.stringify(all) }),
      }).catch(() => {
        // 落盘失败静默（localStorage 仍兜底）
      });
    } catch {
      // 同步异常同样静默
    }
  };
  // 解析 chatThreads-{pid} 格式的对话 JSON；返回 null 表示格式无效（走旧 chatMessages 迁移）
  const parseThreadsRaw = (raw: string): { threads: Thread[]; activeId: string } | null => {
    const validMsg = (m: unknown): m is Msg => {
      const x = m as Msg;
      return !!x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string";
    };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.threads)) {
        const t = parsed.threads
          .filter((x: unknown) => { const th = x as Thread; return th && typeof th.id === "string" && Array.isArray(th.messages); })
          .map((x: Thread) => ({ id: x.id, name: typeof x.name === "string" ? x.name : "对话", messages: x.messages.filter(validMsg) }));
        const activeId = t.some((x: Thread) => x.id === parsed.activeId) ? String(parsed.activeId) : t[0]?.id ?? "";
        if (t.length > 0) return { threads: t, activeId };
      }
    } catch { /* 格式无效走旧迁移 */ }
    return null;
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
        const parsed = parseThreadsRaw(raw);
        if (parsed) return parsed;
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
    setPendingAttachments([]);
    setError("");
    setConfirmReq(null);
    setWaitingAnswer(null);
    // 本地无对话时尝试从 data/ 全量备份恢复（清浏览器缓存/换浏览器后刷新仍可找回）
    if (!localStorage.getItem(threadsKey(currentProjectId)) && !localStorage.getItem(chatKey(currentProjectId)) && process.env.NODE_ENV !== "test") {
      const pid = currentProjectId;
      fetch("/api/data?kind=chat")
        .then((r) => r.json())
        .then((j) => {
          if (!j?.ok || !j.data) return;
          const all = JSON.parse(j.data) as Record<string, unknown>;
          const raw = all[threadsKey(pid)];
          if (!raw) return;
          const parsed = parseThreadsRaw(JSON.stringify(raw));
          if (!parsed || useCanvasStore.getState().currentProjectId !== pid) return;
          threadsRef.current = parsed.threads;
          activeThreadIdRef.current = parsed.activeId;
          setThreads(parsed.threads);
          setActiveThreadId(parsed.activeId);
          const restored = parsed.threads.find((t) => t.id === parsed.activeId)?.messages ?? [];
          messagesRef.current = restored;
          setMessages(restored);
          // 写回 localStorage，后续刷新走快速路径
          localStorage.setItem(threadsKey(pid), JSON.stringify(raw));
        })
        .catch(() => {});
    }
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
    setPendingAttachments([]);
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
    setPendingAttachments([]);
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

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, liveStatus, activity]);

  // A3 提问澄清：收到问题后聚焦输入框，等待用户回答
  useEffect(() => {
    if (waitingAnswer) inputRef.current?.focus();
  }, [waitingAnswer]);

  const parseFiles = async (selected: File[]) => {
    const available = MAX_ATTACHMENT_COUNT - pendingAttachments.length;
    if (available <= 0) {
      setError(`每次最多上传 ${MAX_ATTACHMENT_COUNT} 个文件`);
      return;
    }
    const files = selected.slice(0, available);
    if (selected.length > available) setError(`每次最多上传 ${MAX_ATTACHMENT_COUNT} 个文件，已忽略多余文件`);
    setUploadingCount((count) => count + files.length);
    for (const file of files) {
      try {
        if (!isAcceptedAttachment(file.name)) throw new Error("不支持该格式");
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("文件超过 20 MB");
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/files/parse", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.file) throw new Error(data.error || `解析失败 (${response.status})`);
        setPendingAttachments((current) => [...current, data.file as ParsedAttachment].slice(0, MAX_ATTACHMENT_COUNT));
        setError("");
      } catch (uploadError) {
        setError(`${file.name}：${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
      } finally {
        setUploadingCount((count) => Math.max(0, count - 1));
      }
    }
  };

  const makeUserMessage = (text: string, attachments: ParsedAttachment[]): Msg => {
    if (attachments.length === 0) return { role: "user", content: text.trim() };
    const built = buildAttachmentMessage(text, attachments);
    return { role: "user", ...built };
  };

  // 主生成流程：给定完整消息列表发起 /api/chat 流式生成（send 与"确认拒绝/会话过期后自动续跑"共用）
  const runGeneration = async (next: Msg[]) => {
    if (useCanvasStore.getState().isGenerating) return;
    const generationId = ++generationIdRef.current;
    const isCurrentGeneration = () => generationIdRef.current === generationId;
    // 提问澄清的回答复用主流程：问题已在 messages 中，此处只追加回答，上下文完整 AI 会继续执行
    setWaitingAnswer(null);
    setQuestionOptions(null);
    setCustomAnswerOpen(false);
    setCustomAnswerText("");
    referencedRef.current = [];
    const s = useCanvasStore.getState();
    requestProjectIdRef.current = s.currentProjectId;
    const settings = loadSettings();
    // 生成前画布作为撤销基线：snapshot 中间态不入栈，生成完成后整体一步 undo 回到该基线；
    // new-canvas 事件后基线重置为新画布的空态
    let baseline = structuredClone(s.doc);
    messagesRef.current = next;
    setMessages(next);
    setInput("");
    setActivity([]);
    setError("");
    setLiveStatus({ phase: "thinking", message: "正在连接 AI 并读取当前任务…" });
    setCanvasSync({ revision: 0, elements: s.doc.elements.length });
    setGenerating(true);
    // 生成前基线：基线内元素允许被 AI 快照合并替换；基线外且未被 AI 触碰的本地元素保留
    useCanvasStore.getState().setAiBaseline(s.doc.elements.map((e) => e.id));
    // 队列续跑暂停标记：stream 收到 question（提问）或 confirm-request（确认）时置 true，
    // 本轮结束不自动续跑队列——需用户先表态/回答（finally 引用，须声明在 try 外）
    let queuePaused = false;
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestController.signal,
        body: JSON.stringify({
          messages: next,
          canvas: s.doc as CanvasDocument,
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
          model: settings.model,
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
      // 被新请求取代后不再等待或处理旧响应；尽力关闭响应体，但不把关闭完成作为启动新任务的前提。
      if (!isCurrentGeneration()) {
        void res.body?.cancel().catch(() => undefined);
        return;
      }
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
      let superseded = false;
      // 流看门狗：页面闲置/网络挂起/服务端无响应时，长时间收不到事件就主动中断本次生成，
      // 避免 reader.read() 永久挂起导致 isGenerating 卡 true（快捷键 Ctrl+Z/Y 被拦截、无法发起新生成）
      let timedOut = false;
      let lastEvent = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastEvent > 120_000) {
          timedOut = true;
          try { reader.cancel(); } catch { /* 已结束则忽略 */ }
        }
      }, 15_000);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line) {
            if (!isCurrentGeneration()) {
              superseded = true;
              break;
            }
            lastEvent = Date.now();
            // A5 画布守卫：生成中切到其他画布 → 丢弃本轮全部事件（new-canvas 无例外，切换后到达的一样丢弃）
            if (useCanvasStore.getState().currentProjectId !== requestProjectIdRef.current) {
              abandoned = true;
              break;
            }
            const ev = JSON.parse(line) as AgentEvent;
            if (ev.type === "status") {
              setLiveStatus({ phase: ev.phase, message: ev.message });
            }
            else if (ev.type === "progress") {
              const items = ev.activity ?? [];
              if (items.length) {
                useCanvasStore.setState((s) => ({ activity: [...s.activity, ...items] }));
              }
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
              setCanvasSync((receipt) => ({ revision: receipt.revision + 1, elements: ev.canvas.elements.length }));
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
              setLiveStatus(null);
            } else if (ev.type === "question") {
              // A3 提问澄清：若 AI 提问前已画了元素（不应发生）则按问题优先全部丢弃——恢复生成前基线；
              // 问题作为 assistant 消息入对话，等待用户回答后走主流程继续生成
              queuePaused = true;
              if (lastSnapshot) useCanvasStore.getState().applyAISnapshot(baseline);
              lastSnapshot = null;
              const refs = referencedRef.current;
              referencedRef.current = [];
              setMessages((m) => [...m, { role: "assistant", content: ev.question, referenced: refs.length ? refs.join("、") : undefined }]);
              setWaitingAnswer(ev.question);
              // A9 可点击选项：AI 提供选项时渲染可点击按钮，点选即作为回答发送
              setQuestionOptions(ensureOtherOption(ev.options) ?? null);
              setCustomAnswerOpen(false);
              setCustomAnswerText("");
              setLiveStatus(null);
            } else if (ev.type === "confirm-request") {
              // 生成主体结束：把最后快照作为最终结果入历史（一步 undo 回到生成前），再弹确认框；
              // AI 文字回复先入对话（与 complete 分支的 summary 行为一致，空串不产生气泡）
              queuePaused = true;
              if (lastSnapshot) useCanvasStore.getState().applyAIResult(lastSnapshot, baseline);
              if (ev.summary) {
                const refs = referencedRef.current;
                referencedRef.current = [];
                setMessages((m) => [...m, { role: "assistant", content: ev.summary, referenced: refs.length ? refs.join("、") : undefined }]);
              }
              setConfirmReq({ sessionId: ev.sessionId, summary: ev.summary, pending: ev.pending });
              setLiveStatus(null);
            } else if (ev.type === "error") {
              setError(ev.message);
              setLiveStatus(null);
            }
            else if (ev.type === "referenced") {
              // 跨画布引用：记录画布名，追加 assistant 消息时打标（气泡下方显示「引用了…画布」）
              referencedRef.current = [...referencedRef.current, ev.canvasName];
            } else if (ev.type === "heartbeat") {
              // 服务端心跳保活：模型整轮思考/网络慢速期间无业务事件，仅用于刷新 lastEvent，
              // 让看门狗不把「模型慢」误判为「连接死」——这里无需任何业务处理
            }
          }
            nl = buf.indexOf("\n");
          }
          if (abandoned || superseded) break;
        }
      } finally {
        clearInterval(watchdog);
      }
      if (superseded || !isCurrentGeneration()) {
        void reader.cancel().catch(() => undefined);
        return;
      }
      if (timedOut) setError("生成超时：长时间未收到响应，已中断本次生成，请重试");
      else if (abandoned) {
        // 画布已切换：消息上下文已变，暂停队列续跑，避免把旧画布的排队消息注入新画布对话
        queuePaused = true;
        setError("画布已切换，本次生成已丢弃");
      } else if (finalDoc) {
        useCanvasStore.getState().applyAIResult(finalDoc, baseline);
        if (summary) {
          const refs = referencedRef.current;
          referencedRef.current = [];
          // 同步 messagesRef：finally 的队列续跑以此为消息基线，必须带上本轮 AI 摘要
          const assistantMsg: Msg = { role: "assistant", content: summary, referenced: refs.length ? refs.join("、") : undefined };
          messagesRef.current = [...messagesRef.current, assistantMsg];
          setMessages(messagesRef.current);
        }
      }
    } catch (err) {
      if (!isCurrentGeneration()) {
        // 已被新任务取代：旧请求的任何迟到错误均静默丢弃。
      } else if (requestController.signal.aborted && requestController.signal.reason === QUEUE_INTERRUPT_REASON) {
        setError("");
      } else {
        setError("生成中断：" + String(err));
      }
    } finally {
      // 只有当前代次可以收尾。旧请求迟到的 finally 不能关掉新请求的生成状态或误取下一条队列。
      if (isCurrentGeneration()) {
        if (requestAbortRef.current === requestController) requestAbortRef.current = null;
        // 生成结束：解除全部锁定与基线（applyAIResult 已把最终画布合并入栈）
        useCanvasStore.getState().setAiLocked([]);
        useCanvasStore.getState().setAiBaseline([]);
        setLiveStatus(null);
        setGenerating(false);
        // 队列续跑：本轮生成正常结束（未提问/未确认挂起）→ 自动执行队首排队消息；
        // question/confirm-request 已置 queuePaused，等待用户表态后由回答/确认流程继续
        if (!queuePaused) {
          const queued = queueRef.current;
          if (queued.length > 0) {
            const head = queued[0];
            queueRef.current = queued.slice(1);
            setQueue(queueRef.current);
            void runGeneration([...messagesRef.current, makeUserMessage(head.text, head.attachments)]);
          }
        }
      }
    }
  };

  // 用户发送：读输入框 → 追加用户消息 → 走主生成流程；仍有未解决的确认项时禁止发起新生成
  const send = () => {
    const text = input.trim();
    const attachments = pendingAttachments;
    if ((!text && attachments.length === 0) || uploadingCount > 0 || (confirmReq && confirmReq.pending.length > 0)) return;
    // 生成中：不阻塞输入——消息入队等待，当前生成结束后按序自动执行（可拖拽排序/点击置顶/编辑/删除）
    if (useCanvasStore.getState().isGenerating) {
      const item: QueueItem = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, attachments };
      queueRef.current = [...queueRef.current, item];
      setQueue(queueRef.current);
      setInput("");
      setPendingAttachments([]);
      return;
    }
    setPendingAttachments([]);
    void runGeneration([...messages, makeUserMessage(text, attachments)]);
  };

  // 队列操作：删除 / 点击置顶优先（引导模型先处理这条）/ 拖拽重排 / 内联编辑
  const removeQueueItem = (id: string) => {
    queueRef.current = queueRef.current.filter((q) => q.id !== id);
    setQueue(queueRef.current);
    if (editingQueueId === id) setEditingQueueId(null);
  };
  const moveQueueFront = (id: string) => {
    const item = queueRef.current.find((q) => q.id === id);
    if (!item) return;
    queueRef.current = [item, ...queueRef.current.filter((q) => q.id !== id)];
    setQueue(queueRef.current);
  };
  const reorderQueue = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...queueRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    queueRef.current = next;
    setQueue(next);
  };
  const startQueueEdit = (item: QueueItem) => {
    setEditingQueueId(item.id);
    setEditingQueueText(item.text);
  };
  const saveQueueEdit = () => {
    const text = editingQueueText.trim();
    if (editingQueueId && text) {
      queueRef.current = queueRef.current.map((q) => (q.id === editingQueueId ? { ...q, text } : q));
      setQueue(queueRef.current);
    }
    setEditingQueueId(null);
  };

  // A9 可点击选项：点选选项即作为回答发送（问题已在 messages 中，追加选项文本后继续生成）
  const answerOption = async (opt: string) => {
    if (useCanvasStore.getState().isGenerating || (confirmReq && confirmReq.pending.length > 0)) return;
    if (isOtherOption(opt)) {
      setCustomAnswerOpen(true);
      return;
    }
    setCustomAnswerOpen(false);
    setCustomAnswerText("");
    await runGeneration([...messages, { role: "user" as const, content: opt }]);
  };

  const interruptAndRunQueue = (id: string) => {
    if (!useCanvasStore.getState().isGenerating || interruptingRef.current) return;
    const selected = queueRef.current.find((item) => item.id === id);
    if (!selected) return;
    interruptingRef.current = true;
    // 先从队列中原子取出目标；不等待旧流的 catch/finally，直接释放生成锁并启动新代次。
    queueRef.current = queueRef.current.filter((item) => item.id !== id);
    setQueue(queueRef.current);
    generationIdRef.current += 1;
    const previousRequest = requestAbortRef.current;
    requestAbortRef.current = null;
    previousRequest?.abort(QUEUE_INTERRUPT_REASON);
    useCanvasStore.getState().setAiLocked([]);
    useCanvasStore.getState().setAiBaseline([]);
    setGenerating(false);
    setError("");
    setLiveStatus({ phase: "thinking", message: `正在切换到“${queuePreviewText(selected.text, selected.attachments.map((file) => file.name))}”…` });
    void runGeneration([...messagesRef.current, makeUserMessage(selected.text, selected.attachments)]);
    interruptingRef.current = false;
  };

  const submitCustomAnswer = async () => {
    const answer = customAnswerText.trim();
    if (!answer || useCanvasStore.getState().isGenerating) return;
    setCustomAnswerOpen(false);
    setCustomAnswerText("");
    await runGeneration([...messages, { role: "user" as const, content: answer }]);
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
      let restLen = 0;
      setConfirmReq((c) => {
        if (!c) return c;
        const rest = c.pending.filter((p) => p.id !== id);
        restLen = rest.length;
        return rest.length > 0 ? { ...c, pending: rest } : null;
      });
      // 用户拒绝（不允许）→ 让 AI 知道并继续：追加系统提示、自动续跑，AI 可据此调整方案或继续向用户提问，
      // 而不是直接关闭 AI 会话（"所有的请求如果不允许，应该让 AI 知道"）
      if (!approved) {
        const notice: Msg = { role: "user", content: `（系统提示：用户拒绝了操作「${desc}」。请根据情况调整方案：可以询问用户希望如何处理，或改用其他替代方案；不要重复执行已被拒绝的操作。）` };
        const next = [...messages, { role: "assistant" as const, content: `已取消：${desc}` }, notice];
        setMessages(next);
        void runGeneration(next);
      } else if (restLen === 0) {
        // 用户允许且全部挂起项都已处理 → 让 AI 知道操作已执行并继续（如清空画布后基于空白画布重画新内容），
        // 避免「确认清空后 AI 直接结束、没有画任何东西」
        const notice: Msg = { role: "user", content: `（系统提示：用户已确认操作「${desc}」，操作已执行。请继续完成当前任务——若刚清空画布，请基于空白画布绘制用户要求的内容；若刚新建画布，请在新画布上继续。不要重复执行已确认的操作。）` };
        const next = [...messages, { role: "assistant" as const, content: `已确认：${desc}` }, notice];
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

  const phaseLabel = liveStatus?.phase === "drawing" ? "正在绘制" : liveStatus?.phase === "checking" ? "正在检查" : "正在规划";
  const syncReceipt = canvasSync.revision > 0
    ? `已同步 ${canvasSync.revision} 次 · ${canvasSync.elements} 个对象`
    : liveStatus?.phase === "checking"
      ? "只读检查 · 画布未变更"
      : liveStatus?.phase === "drawing"
        ? "等待首个画布操作"
        : "规划阶段 · 画布未变更";

  return (
    <div className="flex h-full flex-col bg-[#f7f9fc] text-slate-800">
      {/* 对话标签页：多对话切换 / 新建 / 删除 / 右键重命名（单画布内） */}
      <div className="border-b border-slate-200/80 bg-white px-3 pb-2 pt-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-900 text-blue-200 shadow-[0_5px_14px_rgba(15,23,42,0.18)]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
                <path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">科研绘图助手</div>
            </div>
          </div>
          <span className={`flex items-center gap-1.5 text-[10px] font-medium ${isGenerating ? "text-blue-700" : "text-emerald-700"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isGenerating ? "animate-pulse bg-blue-500" : "bg-emerald-500"}`} aria-hidden="true" />
            {isGenerating ? "工作中" : "就绪"}
          </span>
        </div>
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
                className={`flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs transition-colors ${
                  active ? "bg-slate-100 font-medium text-slate-900 ring-1 ring-inset ring-slate-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
                  className="lift flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs leading-none opacity-55 hover:bg-red-500 hover:text-white hover:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            title="新建对话"
            onClick={newThread}
            className="lift flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800"
          >
            +
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-10 pt-4 text-sm" ref={bodyRef}>
        {messages.length === 0 && !isGenerating && (
          <div className="mx-auto mt-8 max-w-[17rem] text-center" data-testid="chat-empty">
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_5px_16px_rgba(15,23,42,0.06)]">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3Z" />
                <path d="M7 9h10M7 13h6" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700">告诉AI你想画什么</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="group/msg relative after:absolute after:left-0 after:right-0 after:top-full after:h-7 after:content-['']">
            <div className={`flex min-w-0 ${m.role === "user" ? "ml-auto max-w-[86%] flex-col items-end" : "max-w-[94%] flex-col items-start"}`}>
              <div
                data-testid="message-bubble"
                className={`msg-in min-w-0 max-w-full w-fit overflow-hidden whitespace-pre-wrap break-words px-3.5 py-2.5 leading-6 ${
                  m.role === "user"
                    ? "rounded-[15px_15px_5px_15px] bg-blue-600 text-white shadow-[0_5px_14px_rgba(37,99,235,0.18)]"
                    : "rounded-[5px_15px_15px_15px] border border-slate-200 bg-white text-slate-700 shadow-[0_5px_16px_rgba(15,23,42,0.05)]"
                }`}
              >
                {m.displayContent ?? m.content}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 flex w-full min-w-0 flex-col gap-1.5" data-testid="message-attachments">
                    {m.attachments.map((file) => (
                      <div key={`${file.name}-${file.size}`} data-testid="message-attachment" className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-[10px] ${m.role === "user" ? "bg-white/14 text-blue-50" : "bg-slate-50 text-slate-600"}`}>
                        <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                          <path d="M14 2v6h6M8 13h8M8 17h5" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="shrink-0 opacity-70">{formatFileSize(file.size)}</span>
                        {file.truncated && <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-700">已截取</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* 思考过程：AI 生成中在气泡内部显示操作步骤（取代外部活动气泡）；
                    最后一条 assistant 消息承载当前生成/确认的思考过程 */}
                {m.role === "assistant" && i === messages.length - 1 && isGenerating && activity.length > 0 && (
                  <div data-testid="thinking-steps" className="mt-2 space-y-1 border-t border-white/50 pt-2">
                    {activity.map((a, idx) => (
                      <div key={`${idx}-${a}`} className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className={idx === activity.length - 1 ? "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" : "shrink-0 text-emerald-500"}>
                          {idx === activity.length - 1 ? "" : "✓"}
                        </span>
                        <span>{a}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* 确认/拒绝：AI 想执行破坏性操作时，在气泡内逐条给允许/不允许（取代外部确认弹窗） */}
                {m.role === "assistant" && i === messages.length - 1 && confirmReq && confirmReq.pending.length > 0 && (
                  <div className="mt-2 space-y-2 border-t border-white/50 pt-2" data-testid="confirm-inline">
                    {confirmReq.pending.map((p) => (
                      <div key={p.id} className="rounded-lg border border-white/60 bg-white/70 px-2.5 py-2 shadow-sm backdrop-blur-xl">
                        <div className="mb-1.5 text-xs text-gray-700">{p.description}</div>
                        <div className="flex gap-2">
                          <button
                            disabled={confirmBusy}
                            onClick={() => confirmAction(p.id, true)}
                            className="lift rounded-md bg-blue-600/85 px-2.5 py-0.5 text-xs text-white disabled:opacity-50"
                          >
                            允许
                          </button>
                          <button
                            disabled={confirmBusy}
                            onClick={() => confirmAction(p.id, false)}
                            className="lift rounded-md bg-red-500/85 px-2.5 py-0.5 text-xs text-white disabled:opacity-50"
                          >
                            不允许
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                {/* 可点击选项：最后一项固定为“其他”，展开输入框收集自定义答案。 */}
                {m.role === "assistant" && waitingAnswer && m.content === waitingAnswer && questionOptions && (
                  <div className="mt-2 space-y-2" data-testid="question-options">
                    <div className="flex flex-wrap gap-1.5">
                      {questionOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => answerOption(opt)}
                          aria-expanded={isOtherOption(opt) ? customAnswerOpen : undefined}
                          className="lift group/opt flex items-center gap-1.5 rounded-full border border-blue-300/60 bg-gradient-to-b from-white/95 to-blue-50/90 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm backdrop-blur-xl transition-all hover:border-blue-400 hover:from-blue-50 hover:to-blue-100 hover:shadow-md active:scale-95"
                        >
                          {isOtherOption(opt) ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-60">
                              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-60 transition-transform group-hover/opt:scale-110">
                              <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
                            </svg>
                          )}
                          {opt}
                        </button>
                      ))}
                    </div>
                    {customAnswerOpen && (
                      <div data-testid="custom-answer-box" className="flex min-w-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white p-1.5 shadow-sm">
                        <input
                          autoFocus
                          data-testid="custom-answer-input"
                          value={customAnswerText}
                          onChange={(event) => setCustomAnswerText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void submitCustomAnswer();
                            }
                          }}
                          placeholder="输入你的答案…"
                          aria-label="其他答案"
                          className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => void submitCustomAnswer()}
                          disabled={!customAnswerText.trim()}
                          className={[
                            "lift h-7 shrink-0 rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white",
                            "disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500",
                          ].join(" ")}
                        >
                          提交
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* 复制按钮：绝对定位于气泡下方间隙（不占文档流，显示时也不挤开后续对话）。
                  hover 保持：容器 after 向下延伸热区（与按钮重叠），鼠标从气泡移向按钮的路径上
                  容器始终处于 hover（group-hover 不失效），到达按钮后按钮自身 hover 保持，不会闪隐 */}
              <button
                title={copiedMessage === i ? "已复制" : "复制"}
                aria-label={copiedMessage === i ? "已复制" : "复制消息"}
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(m.displayContent ?? m.content);
                    setCopiedMessage(i);
                    window.setTimeout(() => setCopiedMessage((current) => current === i ? null : current), 1400);
                  } catch {
                    // 浏览器拒绝剪贴板权限时保持原状态，不显示虚假成功。
                  }
                }}
                className={`pointer-events-none absolute top-full z-10 mt-1 grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 opacity-0 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-[opacity,color,background-color,border-color,transform] duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 active:translate-y-px group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                  m.role === "user" ? "right-0" : "left-0"
                }`}
              >
                {copiedMessage === i ? (
                  <svg className="text-emerald-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="8" y="8" width="11" height="11" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
        {isGenerating && messages.length > 0 && messages[messages.length - 1].role === "user" && (
          <div
            data-testid="ai-typing"
            aria-live="polite"
            className="msg-in relative w-full overflow-hidden rounded-2xl bg-slate-900 px-4 py-3.5 text-white shadow-[0_10px_28px_rgba(15,23,42,0.20)]"
          >
            <span className="ai-live-scan absolute inset-x-0 top-0 h-0.5 bg-blue-400" aria-hidden="true" />
            <div className="flex items-start gap-2.5">
              <span className="relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-blue-300">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
                </svg>
                <span className="ai-live-pulse absolute inset-0 rounded-lg border border-blue-300/60" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">
                    {phaseLabel}
                  </span>
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-blue-200" data-testid="canvas-sync-receipt">
                    {syncReceipt}
                  </span>
                </div>
                <p key={liveStatus?.message} className="toast-in mt-1 text-xs leading-5 text-slate-300">
                  {liveStatus?.message ?? "正在理解需求、识别图类型并组织信息层级…"}
                </p>
              </div>
            </div>
            {activity.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-white/10 pt-2.5" data-testid="thinking-steps">
                {activity.slice(-5).map((a, idx, shown) => (
                  <div key={`${activity.length - shown.length + idx}-${a}`} className="flex items-start gap-1.5 text-[11px] leading-4 text-slate-300">
                    <svg className="mt-0.5 shrink-0 text-emerald-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</div>}
      </div>
      {/* AI 思考过程已整合进对话气泡（不再单独挂外部活动气泡） */}
      <div className="border-t border-slate-200 bg-white p-3">
        {/* 生成队列：生成中回车发送的消息排队等待；每项均可打断执行、拖拽排序、置顶、编辑或删除 */}
        {queue.length > 0 && (
          <div data-testid="generation-queue" className="mb-2 space-y-1">
            <div className="flex items-center px-1">
              <span className="text-[10px] font-semibold text-slate-500">等待队列（{queue.length}）</span>
            </div>
            {queue.map((item, i) =>
              editingQueueId === item.id ? (
                <div key={item.id} data-testid="queue-editing" className="flex items-center gap-1.5 rounded-xl border border-blue-300 bg-white px-2 py-1.5 shadow-sm">
                  <input
                    data-testid="queue-edit-input"
                    autoFocus
                    value={editingQueueText}
                    onChange={(e) => setEditingQueueText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveQueueEdit(); } }}
                    onBlur={saveQueueEdit}
                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none"
                  />
                  <button data-testid="queue-edit-save" onClick={saveQueueEdit} title="保存" className="lift grid h-5 w-5 shrink-0 place-items-center rounded text-xs text-emerald-600 hover:bg-emerald-50">
                    ✓
                  </button>
                </div>
              ) : (
                <div
                  key={item.id}
                  data-testid="queue-item"
                  draggable
                  onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; setDragIndex(i); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (dragIndex != null) reorderQueue(dragIndex, i); setDragIndex(null); }}
                  onDragEnd={() => setDragIndex(null)}
                  className={`flex cursor-grab items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 shadow-sm ${dragIndex === i ? "border-blue-300 opacity-50" : "border-slate-200"}`}
                >
                  <span className="shrink-0 text-[11px] leading-none text-slate-300" title="拖动排序">⋮⋮</span>
                  <button
                    data-testid="queue-move-front"
                    title="点击置顶，优先执行"
                    onClick={() => moveQueueFront(item.id)}
                    aria-label={`置顶：${queuePreviewText(item.text, item.attachments.map((file) => file.name))}`}
                    className="min-w-0 flex-1 overflow-hidden text-left text-xs text-slate-700 hover:text-blue-600"
                  >
                    <span
                      data-testid="queue-preview"
                      title={queuePreviewText(item.text, item.attachments.map((file) => file.name))}
                      className="block overflow-hidden text-ellipsis whitespace-nowrap"
                    >
                      {queuePreviewText(item.text, item.attachments.map((file) => file.name))}
                    </span>
                  </button>
                  {item.attachments.length > 0 && <span className="shrink-0 text-[10px] text-blue-600">{item.attachments.length} 个附件</span>}
                  <button
                    type="button"
                    data-testid="queue-interrupt"
                    title="打断当前生成并执行此消息"
                    aria-label={`打断并执行：${queuePreviewText(item.text, item.attachments.map((file) => file.name))}`}
                    onClick={() => interruptAndRunQueue(item.id)}
                    disabled={!isGenerating}
                    className="lift grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2.5" y="3" width="4" height="4" rx="0.8" />
                      <path d="M9 4.25h3.5v3.5M12.5 4.25 8.75 8" />
                      <path d="M13.5 10.5a3 3 0 0 1-3 3h-7" />
                    </svg>
                  </button>
                  <button data-testid="queue-edit" title="编辑" onClick={() => startQueueEdit(item)} className="lift grid h-5 w-5 shrink-0 place-items-center rounded text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    ✎
                  </button>
                  <button data-testid="queue-delete" title="删除" onClick={() => removeQueueItem(item.id)} className="lift grid h-5 w-5 shrink-0 place-items-center rounded text-xs text-slate-400 hover:bg-red-50 hover:text-red-500">
                    ×
                  </button>
                </div>
              )
            )}
          </div>
        )}
        <div
          className={`relative rounded-2xl border p-2 shadow-[0_5px_18px_rgba(15,23,42,0.06)] transition-colors focus-within:border-blue-300 focus-within:bg-white ${isFileDragOver ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200/70" : "border-slate-200 bg-slate-50"}`}
          onDragEnter={(event) => { event.preventDefault(); setIsFileDragOver(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsFileDragOver(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFileDragOver(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setIsFileDragOver(false);
            void parseFiles(Array.from(event.dataTransfer.files));
          }}
          data-testid="chat-file-dropzone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            data-testid="chat-file-input"
            onChange={(event) => {
              void parseFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          {isFileDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-blue-50/95 text-xs font-semibold text-blue-700 backdrop-blur-sm">
              松开即可解析文件
            </div>
          )}
          {(pendingAttachments.length > 0 || uploadingCount > 0) && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 px-1" data-testid="pending-attachments">
              {pendingAttachments.map((file) => (
                <div key={file.id} className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-lg border border-blue-200 bg-white px-2 py-1 text-[10px] text-slate-600 shadow-sm">
                  <span className="max-w-[10rem] truncate font-medium text-slate-700">{file.name}</span>
                  <span className="text-slate-400">{formatFileSize(file.size)}</span>
                  {file.truncated && <span className="text-amber-600" title="正文较长，已截取适合模型上下文的部分">已截取</span>}
                  <button
                    type="button"
                    title={`移除 ${file.name}`}
                    aria-label={`移除 ${file.name}`}
                    onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== file.id))}
                    className="grid h-4 w-4 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
              ))}
              {uploadingCount > 0 && <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-blue-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />正在解析 {uploadingCount} 个文件…</div>}
            </div>
          )}
          <textarea
          id="chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={waitingAnswer ? "回答后继续生成…" : "描述你想画的图，或拖入研究材料…"}
            rows={3}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingCount > 0 || pendingAttachments.length >= MAX_ATTACHMENT_COUNT}
                title="上传 Word、PDF、PowerPoint 或 Excel"
                aria-label="上传文件"
                className="lift grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.8l8.6-8.6" />
                </svg>
              </button>
              <span className="truncate text-[10px] text-slate-400">拖拽或点击上传 · 最大 20 MB</span>
            </div>
            <button
              onClick={send}
              disabled={(!input.trim() && pendingAttachments.length === 0) || uploadingCount > 0}
              className="lift flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white shadow-[0_4px_10px_rgba(15,23,42,0.18)] hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {isGenerating ? "排队" : "一键生成"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 14-8-4 16-3-6-7-2Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {confirmReq && confirmReq.pending.length > 0 && (
        <div className="px-3 pb-2 text-center text-[10px] text-gray-400">请在对话气泡内选择允许或不允许</div>
      )}
    </div>
  );
}
