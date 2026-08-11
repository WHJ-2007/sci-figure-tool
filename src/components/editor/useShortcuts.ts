"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { newId } from "@/lib/canvas/elements";

export function useShortcuts() {
  useEffect(() => {
    // WASD 连续移动：按下即动一步 + rAF 循环每 33ms 一步（≈30fps，与原速率一致）。
    // 不依赖 OS 按键自动重复——Windows 首次重复延迟约 500ms 导致"卡一下再动"，操作不跟手
    const pressed = new Set<string>();
    let rafId: number | null = null;
    let lastMove = 0;

    const stopLoop = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    const moveStep = () => {
      const s = useCanvasStore.getState();
      const dx = (pressed.has("a") ? 1 : 0) - (pressed.has("d") ? 1 : 0);
      const dy = (pressed.has("w") ? 1 : 0) - (pressed.has("s") ? 1 : 0);
      s.setView({ scale: s.view.scale, ox: s.view.ox + dx * 50, oy: s.view.oy + dy * 50 });
    };
    const loop = (t: number) => {
      if (t - lastMove >= 33) {
        moveStep();
        lastMove = t;
      }
      rafId = requestAnimationFrame(loop);
    };
    const startLoop = () => {
      if (rafId == null) {
        lastMove = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      // 在输入框/文本框内不拦截快捷键（文字编辑时 Ctrl+Z 应恢复输入框自身的撤销）
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        // 生成中禁撤销/重做：快照不入栈，undo 会破坏流式状态；Ctrl+D 复制允许
        if (s.isGenerating && (k === "z" || k === "y")) return;
        if (k === "z" && !e.shiftKey) { e.preventDefault(); s.undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); s.redo(); }
        else if (k === "d") { e.preventDefault(); duplicateSelection(); }
        return;
      }
      // WASD 平移视口（按下即动 50px，按住 rAF 循环每 33ms 一步）；仅移动视图，不影响元素与选区。
      // 相机语义：W=上（内容下移 oy+）、A=左、S=下、D=右；AI 生成中也可平移（边看 AI 绘制边导航）
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d") {
        e.preventDefault();
        if (!pressed.has(k)) {
          pressed.add(k);
          moveStep(); // 按下即动：不等 rAF 帧，消除系统按键延迟的"卡顿感"
          startLoop();
        }
        return;
      }
      // 生成中 Delete/Backspace 放行：锁定的 AI 元素进不了选区，删的是用户自己的元素。
      // 不因 editingText 残留拦截删除：编辑框内按键已被上方 INPUT/TEXTAREA 检查放行（删字符），
      // 焦点已离开编辑框时用户按 Delete 应删除选中的元素（曾出现"选中元素删不掉"的 bug）
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selection.length) {
          e.preventDefault();
          s.deleteElements(s.selection);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d") {
        pressed.delete(k);
        if (pressed.size === 0) stopLoop();
      }
    };
    const onBlur = () => {
      pressed.clear();
      stopLoop();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopLoop();
    };
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
