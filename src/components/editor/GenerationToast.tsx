"use client";

import { useEffect, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

const MAX_ITEMS = 30;

// AI 生成中的提示气泡（位于聊天面板输入框上方）：折叠显示最新动作，点击展开完整时间线；
// 每次新动作滑入弹出；AI 运行时弹出动画（上浮+淡入+缩放），结束后收起动画（下沉+淡出）
export default function GenerationToast() {
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const activity = useCanvasStore((s) => s.activity);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isGenerating) {
      setMounted(true);
      // 弹出动画：先挂载在隐藏态，下一帧加 visible 触发过渡
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [isGenerating, mounted]);

  if (!mounted) return null;
  const items = activity.length > 0 ? activity : ["AI 正在生成…"];
  const latest = items[items.length - 1];
  // 展开时最多回溯 30 条：首行即"当前动作"，其下为已完成步骤 ✓
  const shown = expanded ? items.slice(-MAX_ITEMS) : [latest];

  return (
    <div
      data-testid="generation-toast"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? "收起 AI 操作时间线" : "展开 AI 操作时间线"}
      onClick={() => setExpanded((x) => !x)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((x) => !x);
        }
      }}
      className={`w-full max-w-sm cursor-pointer rounded-2xl border border-white/50 bg-white/80 p-3 shadow-xl backdrop-blur-md transition-all duration-200 ${
        visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"
      }`}
    >
      <div className="flex w-full items-center gap-2 text-left text-sm text-gray-800">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" />
        <span key={items.length} className="toast-in flex-1 truncate">{latest}</span>
        <span className="shrink-0 text-xs text-gray-400">{expanded ? "▾ 收起" : "▸ 展开"}</span>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-white/60 pt-2">
          {shown.slice(0, -1).map((a, i) => (
            <div key={`${i}-${a}`} className="flex gap-2 py-0.5 text-xs text-gray-500">
              <span className="shrink-0 text-emerald-500">✓</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

