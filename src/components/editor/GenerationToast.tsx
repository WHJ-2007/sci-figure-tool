"use client";

import { useEffect, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

// AI 生成中的左下角提示气泡：弹出/收缩过渡，点击聚焦聊天输入框
export default function GenerationToast() {
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const activity = useCanvasStore((s) => s.activity);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isGenerating) {
      setMounted(true);
      setVisible(true);
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [isGenerating, mounted]);

  if (!mounted) return null;
  const latest = activity.length > 0 ? activity[activity.length - 1] : "AI 正在生成…";
  return (
    <button
      type="button"
      data-testid="generation-toast"
      onClick={() => document.getElementById("chat-input")?.focus()}
      className={`fixed bottom-4 left-4 z-50 max-w-xs rounded-lg border border-white/40 bg-white/70 px-3 py-2 text-left text-sm text-gray-800 shadow-lg backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      {latest}
    </button>
  );
}
