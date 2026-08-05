"use client";

import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

export default function TextEditor({ id, x, y }: { id: string; x: number; y: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const el = useCanvasStore.getState().doc.elements.find((e) => e.id === id) as any;
    if (el) setValue(el.text ?? "");
    ref.current?.focus();
  }, [id]);

  const commit = () => {
    useCanvasStore.getState().updateElement(id, { text: value } as any);
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
          if (e.key === "Escape") { e.stopPropagation(); useCanvasStore.setState({ editingText: null }); }
        }}
        onBlur={commit}
        className="w-full h-full resize-none border border-blue-500 bg-white p-1 text-sm outline-none"
      />
    </foreignObject>
  );
}
