"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadSettings } from "@/lib/settings";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { AgentEvent } from "@/lib/ai/agent";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const setGenerating = useCanvasStore((s) => s.setGenerating);
  const isGenerating = useCanvasStore((s) => s.isGenerating);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, activity]);

  const send = async () => {
    const text = input.trim();
    // 守卫用 getState()：避免订阅闭包在极端时序下被旧请求的 finally 误解锁
    if (!text || useCanvasStore.getState().isGenerating) return;
    const s = useCanvasStore.getState();
    const settings = loadSettings();
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setActivity([]);
    setError("");
    setGenerating(true);
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
            if (ev.type === "progress") setActivity((a) => [...a, ...(ev.activity ?? [])]);
            else if (ev.type === "complete") {
              finalDoc = ev.canvas;
              summary = ev.summary ?? "";
            } else if (ev.type === "error") setError(ev.message);
          }
          nl = buf.indexOf("\n");
        }
      }
      if (finalDoc) {
        useCanvasStore.getState().setDoc(finalDoc);
        if (summary) setMessages((m) => [...m, { role: "assistant", content: summary }]);
      }
    } catch (err) {
      setError("生成中断：" + String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <span className="text-sm font-medium">AI 助手</span>
        <button onClick={() => setOpen(!open)} className="text-xs text-gray-500 hover:text-gray-800">{open ? "收起" : "展开"}</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-lg px-3 py-1.5 ${m.role === "user" ? "ml-auto bg-blue-600 text-white" : "bg-gray-100"}`}>
            {m.content}
          </div>
        ))}
        {activity.length > 0 && (
          <div className="space-y-1 rounded-lg bg-blue-50 p-2 text-xs text-blue-700">
            {activity.map((a, i) => <div key={i}>⚙ {a}</div>)}
          </div>
        )}
        {error && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-600">{error}</div>}
      </div>
      <div className="border-t border-gray-200 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="描述你想画的图…（回车发送）"
          rows={2}
          className="w-full resize-none rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-gray-400">支持一键生成与对话修改</span>
          <button
            onClick={send}
            disabled={isGenerating || !input.trim()}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isGenerating ? "生成中…" : "一键生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
