"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { newId } from "@/lib/canvas/elements";

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      // 在输入框/文本框内不拦截快捷键（文字编辑时 Ctrl+Z 应恢复输入框自身的撤销）
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); s.undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); s.redo(); }
        else if (k === "d") { e.preventDefault(); duplicateSelection(); }
        return;
      }
      // WASD 平移视口（每次 50px，按住自动重复）；仅移动视图，不影响元素与选区。
      // 相机语义：W=上（内容下移 oy+）、A=左、S=下、D=右；AI 生成中也可平移（边看 AI 绘制边导航）
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d") {
        e.preventDefault();
        s.setView({
          scale: s.view.scale,
          ox: s.view.ox + (k === "a" ? 50 : k === "d" ? -50 : 0),
          oy: s.view.oy + (k === "w" ? 50 : k === "s" ? -50 : 0),
        });
        return;
      }
      if (s.isGenerating) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.editingText) return;
        if (s.selection.length) {
          e.preventDefault();
          s.deleteElements(s.selection);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function duplicateSelection() {
  const s = useCanvasStore.getState();
  const selected = s.doc.elements.filter((e) => s.selection.includes(e.id));
  if (!selected.length) return;
  const copies = selected.map((e) => {
    const copy = structuredClone(e);
    copy.id = newId();
    copy.x += 20;
    copy.y += 20;
    if (copy.type === "polyline") {
      copy.points = copy.points.map((p) => ({ x: p.x + 20, y: p.y + 20 }));
    }
    return copy;
  });
  s.addElements(copies);
  s.setSelection(copies.map((c) => c.id));
}
