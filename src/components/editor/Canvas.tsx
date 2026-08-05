"use client";

import { useRef, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { hitTestElement } from "@/lib/canvas/geometry";
import type { CanvasElement } from "@/lib/canvas/types";
import ElementShape from "./ElementShape";
import SelectionOverlay from "./SelectionOverlay";
import TextEditor from "./TextEditor";
import { usePointerInteraction, type DrawPreview } from "./usePointerInteraction";

function previewElement(p: DrawPreview): CanvasElement {
  // 注：TS 对"判别字段本身是联合字面量"的联合在 === 分支后不做剔除，需用结构判别（"points" in p）
  if ("points" in p) {
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    return p.type === "arrow"
      ? makeElement("arrow", first.x, first.y, last.x - first.x, last.y - first.y, { opacity: 0.6 })
      : makeElement("polyline", first.x, first.y, 0, 0, { points: p.points, opacity: 0.6 });
  }
  return makeElement(p.type, p.x, p.y, p.width, p.height, { opacity: 0.6 });
}

export default function Canvas({ viewportWidth, viewportHeight }: { viewportWidth: number; viewportHeight: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const editingText = useCanvasStore((s) => s.editingText);
  const view = useCanvasStore((s) => s.view);
  const setView = useCanvasStore((s) => s.setView);
  const tool = useCanvasStore((s) => s.tool);
  const svgRef = useRef<SVGSVGElement>(null);

  // 每次换算实时读 store 的 view：任何时刻的换算基准都与渲染一致，
  // 不依赖闭包捕获的 view 快照（拖动中若 view 变化会与按下时的 startX 混算，元素位移被放大）
  const worldX = useCallback((clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = useCanvasStore.getState().view;
    return (clientX - (rect?.left ?? 0) - v.ox) / v.scale;
  }, []);
  const worldY = useCallback((clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = useCanvasStore.getState().view;
    return (clientY - (rect?.top ?? 0) - v.oy) / v.scale;
  }, []);

  const { rubber, preview, panning, onPointerDown, onPointerMove, onPointerUp, modeRef } = usePointerInteraction(worldX, worldY);

  // 双击文字元素进入编辑（世界坐标命中，从顶层往下找）
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const s = useCanvasStore.getState();
      if (s.isGenerating || s.tool === "hand") return;
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const top = [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex);
      for (const el of top) {
        if (hitTestElement(el, p)) {
          if (el.type === "text") s.setEditingText(el.id);
          return;
        }
      }
    },
    [worldX, worldY]
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // 拖动/绘制中锁定视口：缩放会改变换算基准，拖动中 view 变化（触控板惯性滚动等）会让
    // 元素位移与指针严重不匹配（"鼠标动 1 格卡片动 20 格"）
    if (modeRef.current.kind !== "idle") return;
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
  const editing = doc.elements.find((e) => e.id === editingText && e.type === "text");

  return (
    <div className="relative h-full w-full select-none overflow-hidden" onWheel={onWheel}>
      <svg
        ref={svgRef}
        width={viewportWidth}
        height={viewportHeight}
        className={`block ${tool === "hand" ? (panning ? "cursor-grabbing" : "cursor-grab") : ""}`}
        data-testid="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
          {sorted.map((e) => (
            <ElementShape key={e.id} e={e} />
          ))}
          {preview && <ElementShape e={previewElement(preview)} />}
          <SelectionOverlay scale={view.scale} />
          {editing && <TextEditor id={editing.id} x={editing.x} y={editing.y} />}
        </g>
        {rubber && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
            <rect x={rubber.x} y={rubber.y} width={rubber.width} height={rubber.height} fill="#2563eb22" stroke="#2563eb" strokeWidth={1} />
          </g>
        )}
      </svg>
    </div>
  );
}
