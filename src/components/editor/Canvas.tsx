"use client";

import { useRef, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import ElementShape from "./ElementShape";

export default function Canvas({ viewportWidth, viewportHeight }: { viewportWidth: number; viewportHeight: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const view = useCanvasStore((s) => s.view);
  const setView = useCanvasStore((s) => s.setView);
  const svgRef = useRef<SVGSVGElement>(null);

  const worldX = useCallback((clientX: number) => (clientX - view.ox) / view.scale, [view]);
  const worldY = useCallback((clientY: number) => (clientY - view.oy) / view.scale, [view]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(4, Math.max(0.25, view.scale * factor));
    setView({
      scale: newScale,
      ox: px - ((px - view.ox) / view.scale) * newScale,
      oy: py - ((py - view.oy) / view.scale) * newScale,
    });
  };

  const sorted = [...doc.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="relative h-full w-full overflow-hidden" onWheel={onWheel}>
      <svg
        ref={svgRef}
        width={viewportWidth}
        height={viewportHeight}
        className="block"
        data-testid="canvas-svg"
      >
        <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
          {sorted.map((e) => (
            <ElementShape key={e.id} e={e} />
          ))}
        </g>
      </svg>
      {selection.length > 0 && (
        <div data-testid="selection-rect" className="pointer-events-none absolute border-2 border-blue-500" style={{ display: "none" }} />
      )}
      {isGenerating && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60">
          <span className="rounded bg-blue-600 px-4 py-2 text-white">AI 正在生成…</span>
        </div>
      )}
    </div>
  );
}
