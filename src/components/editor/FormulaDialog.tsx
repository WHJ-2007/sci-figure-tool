"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas/geometry";
import { latexToUnicode, STRUCTURE_QUICK, GREEK_QUICK, OPERATOR_QUICK, CHEM_QUICK, parseFormulaStructures, applySlotEdit } from "@/lib/canvas/formula";
import { loadSettings } from "@/lib/settings";

// 公式 AI 对话：用户用自然语言描述想要的符号/公式 → 大模型输出公式文本 →
// 点「采用」把公式写入输入框（或整段替换），或「复制」手动使用。
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

// 从 AI 回复里提取公式文本：优先取 ``` 代码块内容，否则用整段回复
function extractFormula(text: string): string {
  const m = text.match(/```(?:latex|tex|unicode)?\s*\n?([\s\S]*?)\n?```/i);
  if (m && m[1].trim()) return m[1].trim();
  return text.trim();
}

// 傻瓜式公式创建/编辑对话框：
// 下方直接平铺「希腊字符」「数学符号」「结构」「化学式」四类面板，按钮直接显示符号（一眼找到），
// 点击插入光标位置；输入框可直接键入 LaTeX 或 Unicode 公式文本作为补充，实时预览，
// 保存时源码写入元素，渲染时 LaTeX 自动转 Unicode。
// 右侧「AI 公式助手」对话窗口：自然语言描述符号需求 → 大模型输出公式 → 采用/复制。
// id 为空 = 新建模式（保存时在画布中心创建 formula 元素）；id 有值 = 编辑已有公式。
export default function FormulaDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  // AI 对话窗口状态：消息列表 / 输入 / 生成中 / 错误
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) { setSrc(""); return; }
    const el = useCanvasStore.getState().doc.elements.find((e) => e.id === id);
    if (el && el.type === "formula") setSrc(el.text);
  }, [id]);

  // 新消息/流式追加时自动滚动到对话底部
  useEffect(() => {
    const el = chatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMsgs]);

  if (id === undefined || id === "") return null;
  const editing = id !== null;

  // 插入到光标位置（无选区时在光标处；有选区则替换选区），插入后光标定位到插入内容末尾
  const insert = (snippet: string) => {
    const ta = taRef.current;
    if (ta) {
      const start = ta.selectionStart ?? src.length;
      const end = ta.selectionEnd ?? src.length;
      const next = src.slice(0, start) + snippet + src.slice(end);
      setSrc(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + snippet.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setSrc((prev) => prev + snippet);
    }
  };

  // AI 对话发送：描述需求 → /api/chat/formula 流式输出 → 追加 assistant 消息
  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const settings = loadSettings();
    if (!settings.apiKey) {
      setChatError("未配置 API Key，请先到设置页填写");
      return;
    }
    // 上一条 assistant 若为生成中占位（content 为空）先移除，再追加新问答
    let base = chatMsgs;
    if (base.length > 0 && base[base.length - 1].role === "assistant" && !base[base.length - 1].content) {
      base = base.slice(0, -1);
    }
    const next: ChatMsg[] = [...base, { role: "user", content: text }, { role: "assistant", content: "" }];
    setChatMsgs(next);
    setChatInput("");
    setChatError("");
    setChatBusy(true);
    try {
      const res = await fetch("/api/chat/formula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => m.content || m.role === "user"),
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
          model: settings.model,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChatError(data.error ?? `请求失败 (${res.status})`);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) { nl = buf.indexOf("\n"); continue; }
          const ev = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (ev.type === "delta") {
            // 流式追加到最后一条 assistant 消息
            setChatMsgs((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { role: "assistant", content: (last?.content ?? "") + (ev.text ?? "") };
              return copy;
            });
          } else if (ev.type === "error") {
            setChatError(ev.message ?? "生成失败");
          }
          nl = buf.indexOf("\n");
        }
      }
    } catch (err) {
      setChatError("请求失败：" + String(err));
    } finally {
      setChatBusy(false);
    }
  };

  // 采用：把 AI 回复里的公式写入输入框（整段替换，便于直接保存）
  const adopt = (reply: string) => {
    setSrc(extractFormula(reply));
    taRef.current?.focus();
  };

  // 复制：把 AI 回复的公式复制到剪贴板
  const copyReply = async (reply: string) => {
    try {
      await navigator.clipboard.writeText(extractFormula(reply));
      setChatError("");
    } catch {
      setChatError("复制失败，请手动选择复制");
    }
  };

  const save = () => {
    const st = useCanvasStore.getState();
    if (editing) {
      const el = st.doc.elements.find((e) => e.id === id);
      if (el && el.type === "formula") st.updateElement(id, { text: src });
    } else {
      // 新建：画布中心创建并选中
      const el = makeElement("formula", CANVAS_WIDTH / 2 - 60, CANVAS_HEIGHT / 2 - 20, 120, 40, { text: src || "x^2" });
      st.addElement(el);
      st.setSelection([el.id]);
    }
    onClose();
  };

  const preview = latexToUnicode(src);
  // 传统公式分位置编辑：把源码解析成结构（求和/积分/分数/根号…）→ 各槽位，
  // 每个槽位对应源码一个区间，改动槽位输入框即改写该处内容
  const structures = parseFormulaStructures(src);

  // 槽位输入框改动 → 精确改写源码对应区间（不破坏其他部分）
  const editSlot = (slot: { start: number; end: number }, value: string) => {
    setSrc(applySlotEdit(src, slot.start, slot.end, value));
  };

  const btnCls = "lift rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-xs text-gray-600 hover:bg-white/90";
  const symCls = "lift h-8 w-8 rounded-lg border border-white/60 bg-white/70 text-sm text-gray-700 shadow-sm hover:bg-white/90 hover:border-blue-300";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="formula-dialog" onClick={onClose}>
      <div className="glass-panel flex max-h-[88vh] w-[54rem] max-w-[96vw] gap-4 p-5" onClick={(e) => e.stopPropagation()}>
        {/* 左：公式编辑（预览 + 输入 + 符号面板） */}
        <div className="min-w-0 w-[32rem] shrink-0 overflow-y-auto">
          <h3 className="mb-3 text-base font-semibold text-gray-800">{editing ? "编辑公式" : "插入公式"}</h3>

          {/* 实时预览：衬线斜体排版，所见即所得 */}
          <div className="mb-2 rounded-xl border border-white/60 bg-white/70 p-3 text-center text-lg italic text-gray-800 shadow-inner">
            {preview || <span className="text-gray-400">公式预览</span>}
          </div>

          {/* 输入：直接粘贴 LaTeX 或 Unicode 公式文本（补充键入） */}
          <textarea
            ref={taRef}
            aria-label="公式源码"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            placeholder={'键入公式（LaTeX 或 Unicode），如 \\frac{a}{b}、x^2、H_2O、E = mc^2'}
            rows={2}
            className="mb-3 w-full resize-none rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
          />

          {/* 传统公式分位置编辑：识别出的结构（求和/积分/分数/根号…）各槽位单独输入，
              点击槽位输入框直接改该位置内容（上面/下面/分子/分母等），实时写回源码并预览 */}
          {structures.length > 0 && (
            <div className="mb-3 rounded-xl border border-white/40 bg-white/50 p-2.5 shadow-sm" data-testid="formula-slots">
              <div className="mb-1.5 text-xs font-semibold text-gray-600">分位置编辑</div>
              <div className="space-y-2">
                {structures.map((st, idx) => (
                  <div key={idx} className="rounded-lg border border-white/60 bg-white/70 p-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-50 text-xs text-blue-600">{st.symbol}</span>
                      <span>{st.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {st.slots.map((slot, si) => (
                        <label key={si} className="flex min-w-[6rem] flex-1 items-center gap-1 text-[10px] text-gray-400">
                          <span className="shrink-0">{slot.label}</span>
                          <input
                            value={slot.value}
                            aria-label={`${st.name} ${slot.label}`}
                            onChange={(e) => editSlot(slot, e.target.value)}
                            className="h-6 w-full min-w-0 flex-1 rounded border border-white/60 bg-white/80 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 希腊字符：直接平铺可选 */}
          <div className="mb-2 text-xs font-semibold text-gray-600">希腊字符</div>
          <div className="mb-3 flex flex-wrap gap-1">
            {GREEK_QUICK.map((it) => (
              <button key={it.label} type="button" title={it.insert} onClick={() => insert(it.insert)} className={symCls}>{it.label}</button>
            ))}
          </div>

          {/* 数学符号：直接平铺可选 */}
          <div className="mb-2 text-xs font-semibold text-gray-600">数学符号</div>
          <div className="mb-3 flex flex-wrap gap-1">
            {OPERATOR_QUICK.map((it) => (
              <button key={it.label} type="button" title={it.insert} onClick={() => insert(it.insert)} className={symCls}>{it.label}</button>
            ))}
          </div>

          {/* 结构模板：直接平铺符号（分数/根号/上下标/求和积分/括号等），一眼找到 */}
          <div className="mb-2 text-xs font-semibold text-gray-600">结构</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {STRUCTURE_QUICK.map((it) => (
              <button key={it.label} type="button" title={`${it.label}：${it.insert}`} onClick={() => insert(it.insert)} className={btnCls}>{it.symbol}</button>
            ))}
          </div>

          {/* 化学式工具：角标 + 反应符号（可逆/双向/气体/沉淀等） */}
          <div className="mb-2 text-xs font-semibold text-gray-600">化学式</div>
          <div className="flex flex-wrap gap-1.5">
            {CHEM_QUICK.map((it) => (
              <button key={it.label} type="button" title={`${it.label}：${it.insert}`} onClick={() => insert(it.insert)} className={btnCls}>{it.symbol}</button>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600">取消</button>
            <button onClick={save} className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white">{editing ? "保存" : "插入"}</button>
          </div>
        </div>

        {/* 右：AI 公式助手——描述需要的符号/公式，大模型输出，点「采用」写入输入框或「复制」手动使用 */}
        <div className="flex min-h-0 w-72 shrink-0 flex-col rounded-xl border border-white/40 bg-white/60 p-3 shadow-sm backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">AI 公式助手</span>
            {chatBusy && <span className="flex items-center gap-1 text-[10px] text-blue-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />生成中</span>}
          </div>
          <div ref={chatBodyRef} data-testid="formula-chat-body" className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-xs">
            {chatMsgs.length === 0 && (
              <p className="text-gray-400">描述你需要的符号或公式，例如「求和符号，上面 i=1 下面 n」。</p>
            )}
            {chatMsgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-auto w-fit max-w-[85%] rounded-[10px_10px_2px_10px] border border-blue-400/40 bg-blue-500/85 px-2.5 py-1.5 text-white shadow-sm">{m.content}</div>
              ) : (
                <div key={i} className="mr-auto w-fit max-w-[85%] rounded-[10px_10px_10px_2px] border border-white/60 bg-white/80 px-2.5 py-1.5 text-gray-800 shadow-sm">
                  {m.content || <span className="text-gray-400">…</span>}
                  {m.content && (
                    <div className="mt-1.5 flex gap-1.5">
                      <button type="button" title="把公式写入输入框" onClick={() => adopt(m.content)} className="lift rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100">采用</button>
                      <button type="button" title="复制公式" onClick={() => copyReply(m.content)} className="lift rounded border border-gray-300 bg-white/70 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-white">复制</button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
          {chatError && <div className="mt-1.5 rounded border border-red-200/60 bg-red-100/40 px-2 py-1 text-[10px] text-red-700">{chatError}</div>}
          <div className="mt-2 flex gap-1.5">
            <textarea
              aria-label="公式描述"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
              placeholder="描述需要的符号/公式…"
              rows={2}
              className="min-h-0 w-full resize-none rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
            />
            <button
              type="button"
              onClick={() => void sendChat()}
              disabled={chatBusy || !chatInput.trim()}
              className="lift shrink-0 self-end rounded-lg bg-blue-600/85 px-2.5 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
