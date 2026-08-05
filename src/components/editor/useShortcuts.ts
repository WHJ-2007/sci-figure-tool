"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { newId } from "@/lib/canvas/elements";

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      if (s.isGenerating) return;
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
