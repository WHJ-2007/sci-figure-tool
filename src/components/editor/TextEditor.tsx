"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

export default function TextEditor({ id, x, y }: { id: string; x: number; y: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  // 提交/取消后置位，拦截卸载时 blur 触发的重复提交（避免一次编辑产生两条历史、Escape 后写回）
  const doneRef = useRef(false);
  useEffect(() => {
    const el = useCanvasStore.getState().doc.elements.find((e) => e.id === id);
    if (el && el.type === "text") setValue(el.text);
    ref.current?.focus();
  }, [id]);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    // 提交只改文字内容、保留文本框尺寸（新版可移动框不按内容重算宽高）；
    // 先入一步历史快照（一次编辑 = 一步撤销），再用 fast 更新避免重复入栈
    const st = useCanvasStore.getState();
    st.commitHistory();
    st.updateElementFast(id, { text: value });
    useCanvasStore.setState({ editingText: null });
  };

  return (
    <foreignObject x={x} y={y} width={200} height={40}>
      <textarea
        ref={ref}
        data-testid="text-editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) commit();
          if (e.key === "Escape") { doneRef.current = true; e.stopPropagation(); useCanvasStore.setState({ editingText: null }); }
        }}
        onBlur={commit}
        className="w-full h-full resize-none select-text border border-blue-500 bg-white p-1 text-sm outline-none"
      />
    </foreignObject>
  );
}
