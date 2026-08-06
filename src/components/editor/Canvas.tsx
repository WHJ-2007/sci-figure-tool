"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { hitTestElement, logicAnchors, arrowPoints, distToSegment, projectOnSegment, elementBounds } from "@/lib/canvas/geometry";
import { loadImageElement } from "@/lib/canvas/imageImport";
import type { CanvasElement } from "@/lib/canvas/types";
import ElementShape from "./ElementShape";
import SelectionOverlay from "./SelectionOverlay";
import TextEditor from "./TextEditor";
import CanvasStyleMenu from "./CanvasStyleMenu";
import ArrowContextMenu, { type ArrowMenuState } from "./ArrowContextMenu";
import { usePointerInteraction, type DrawPreview } from "./usePointerInteraction";

// 画布背景：缺省纯白；"none" 透明；"linear:#c1,#c2" 对角渐变
export function backgroundFill(bg: string | undefined): string {
  if (!bg || bg === "#ffffff") return "#ffffff";
  if (bg === "none") return "none";
  if (bg.startsWith("linear:")) return "url(#canvas-bg-grad)";
  return bg;
}

function backgroundGradient(bg: string | undefined): [string, string] | null {
  if (!bg?.startsWith("linear:")) return null;
  const [c1, c2] = bg.slice(7).split(",");
  if (!c1 || !c2) return null;
  return [c1, c2];
}

function previewElement(p: DrawPreview): CanvasElement {
  // 注：TS 对"判别字段本身是联合字面量"的联合在 === 分支后不做剔除，需用结构判别（"points" in p）
  if ("points" in p) {
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    if (p.type === "arrow") {
      return makeElement("arrow", first.x, first.y, last.x - first.x, last.y - first.y, { strokeOpacity: 0.6 });
    }
    // 线条 = 无头箭头：与成图一致的 arrow + head:"none"
    if (p.type === "line") {
      return makeElement("arrow", first.x, first.y, last.x - first.x, last.y - first.y, { head: "none", strokeOpacity: 0.6 });
    }
    return makeElement("polyline", first.x, first.y, 0, 0, { points: p.points, strokeOpacity: 0.6 });
  }
  if (p.type === "text") {
    // 文字拖动预览：保留拖出框的宽高（makeElement 会按空文字重算成最小尺寸）
    const el = makeElement("text", p.x, p.y, p.width, p.height, { text: "", opacity: 0.6 });
    el.width = p.width;
    el.height = p.height;
    return el;
  }
  return makeElement(p.type, p.x, p.y, p.width, p.height, { opacity: 0.6 });
}

export default function Canvas({ viewportWidth, viewportHeight }: { viewportWidth: number; viewportHeight: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const editingText = useCanvasStore((s) => s.editingText);
  const view = useCanvasStore((s) => s.view);
  const setView = useCanvasStore((s) => s.setView);
  const tool = useCanvasStore((s) => s.tool);
  const aiLockedIds = useCanvasStore((s) => s.aiLockedIds);
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

  const { rubber, preview, panning, anchorHint, movingIds, movePreview, onPointerDown, onPointerMove, onPointerUp, modeRef, startTouchArrow, lastRightClickRef } = usePointerInteraction(worldX, worldY);

  // 右键菜单（画布样式 + 箭头折点）：点击菜单外/Escape 关闭
  const [styleMenu, setStyleMenu] = useState<{ x: number; y: number } | null>(null);
  const [arrowMenu, setArrowMenu] = useState<ArrowMenuState>(null);
  const closeStyleMenu = useCallback(() => setStyleMenu(null), []);
  const closeArrowMenu = useCallback(() => setArrowMenu(null), []);
  useEffect(() => {
    if (!styleMenu && !arrowMenu) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("[data-testid='canvas-style-menu'], [data-testid='arrow-context-menu']")) return;
      setStyleMenu(null);
      setArrowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStyleMenu(null);
        setArrowMenu(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [styleMenu, arrowMenu]);

  // 图片导入：文件 → 图片元素并选中（失败静默）
  const importImageFile = useCallback(async (file: File, cx: number, cy: number) => {
    const el = await loadImageElement(file, cx, cy);
    if (!el) return;
    useCanvasStore.getState().addElement(el);
    useCanvasStore.getState().setSelection([el.id]);
  }, []);

  // 拖入外部图片：落点 = 鼠标世界坐标
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // 阻止浏览器默认打开文件，才允许 drop 触发
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
    void importImageFile(files[0], p.x, p.y);
  };

  // Ctrl+V 粘贴图片：落点 = 当前视口中心的世界坐标（无鼠标位置可用）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const s = useCanvasStore.getState();
      if (s.editingText) return; // 文字编辑中不拦截
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (!it.type.startsWith("image/")) continue;
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const v = s.view;
        void importImageFile(file, (viewportWidth / 2 - v.ox) / v.scale, (viewportHeight / 2 - v.oy) / v.scale);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importImageFile, viewportWidth, viewportHeight]);

  // 双击文字元素进入编辑（世界坐标命中，从顶层往下找）
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const s = useCanvasStore.getState();
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const top = [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex);
      for (const el of top) {
        if (hitTestElement(el, p)) {
          // AI 非阻塞：AI 正在编辑的元素锁定——双击不进编辑
          if (s.aiLockedIds.includes(el.id)) return;
          if (el.type === "text") s.setEditingText(el.id);
          return;
        }
      }
    },
    [worldX, worldY]
  );

  // 右键菜单：指针下的任意箭头（无论是否已选中）→ 选中并弹折点菜单（新建平滑/尖锐/删除）；
  // 右键空白画布 → 画布样式菜单
  const onContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      const s = useCanvasStore.getState();
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const tol = 14 / s.view.scale;
      // 自顶向下找指针下的未锁定箭头（重叠时取最上层）
      for (const el of [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex)) {
        if (el.type !== "arrow" || s.aiLockedIds.includes(el.id)) continue;
        const mid = el.midPoints ?? [];
        for (let i = 0; i < mid.length; i++) {
          if (Math.hypot(p.x - (el.x + mid[i].x), p.y - (el.y + mid[i].y)) <= tol) {
            if (s.selection.length !== 1 || s.selection[0] !== el.id) s.setSelection([el.id]);
            setArrowMenu({
              kind: "midpoint",
              midIndex: i,
              x: Math.min(e.clientX, window.innerWidth - 176),
              y: Math.min(e.clientY, window.innerHeight - 64),
            });
            return;
          }
        }
        const pts = arrowPoints(el);
        for (let i = 1; i < pts.length; i++) {
          if (distToSegment(p, pts[i - 1], pts[i]) <= tol) {
            if (s.selection.length !== 1 || s.selection[0] !== el.id) s.setSelection([el.id]);
            const proj = projectOnSegment(p, pts[i - 1], pts[i]);
            setArrowMenu({
              kind: "segment",
              insertAt: i - 1,
              // 折点为相对坐标（相对箭头起点）
              point: { x: proj.x - el.x, y: proj.y - el.y },
              x: Math.min(e.clientX, window.innerWidth - 176),
              y: Math.min(e.clientY, window.innerHeight - 112),
            });
            return;
          }
        }
        // 右键点在箭头附近（如空白容差内）不弹样式菜单——箭头折点操作优先
        if (hitTestElement(el, p, 12 / s.view.scale)) return;
      }
      // 右键元素（非箭头）不弹画布样式菜单；右键拖拽多选后（lastRightClickRef.dragged）也不弹
      if ((e.target as Element).closest("[data-element-id]")) return;
      const rc = lastRightClickRef.current;
      lastRightClickRef.current = null;
      if (rc?.dragged) return;
      const M_W = 200;
      const M_H = 300;
      setStyleMenu({
        x: Math.min(e.clientX, window.innerWidth - M_W - 8),
        y: Math.min(e.clientY, window.innerHeight - M_H - 8),
      });
    },
    [worldX, worldY, lastRightClickRef]
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
  const grad = backgroundGradient(doc.background);

  return (
    <div className="relative h-full w-full select-none overflow-hidden" onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
      {/* 玻璃面板包裹画布：半透明白 + 背景模糊 + 内高光描边 + 外投影，边缘体现玻璃质感 */}
      <div className="glass-canvas absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg
        ref={svgRef}
        width={viewportWidth}
        height={viewportHeight}
        className={`block ${tool === "select" ? (panning ? "cursor-grabbing" : "cursor-grab") : ""}`}
        data-testid="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {(grad || doc.elements.some((e) => e.shadow)) && (
          <defs>
            {grad && (
              <linearGradient id="canvas-bg-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={grad[0]} />
                <stop offset="1" stopColor={grad[1]} />
              </linearGradient>
            )}
            {/* 元素整体投影：filter id 用元素 id 保证唯一；区域扩到 ±50% 防模糊裁剪 */}
            {doc.elements.map((e) =>
              e.shadow ? (
                <filter key={e.id} id={`sh-${e.id}`} x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx={e.shadow.dx} dy={e.shadow.dy} stdDeviation={e.shadow.blur} floodColor={e.shadow.color} floodOpacity={e.shadow.opacity} />
                </filter>
              ) : null
            )}
          </defs>
        )}
        <rect data-testid="canvas-bg" width={viewportWidth} height={viewportHeight} rx={10} fill={backgroundFill(doc.background)} pointerEvents="none" />
        <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
          {sorted.map((e) => (
            <ElementShape key={e.id} e={e} locked={aiLockedIds.includes(e.id)} ghost={movingIds.includes(e.id)} />
          ))}
          {preview && <ElementShape e={previewElement(preview)} />}
          {/* 拖动预览：虚线框显示"在这里松手元素会落在哪"（含吸附偏移） */}
          {movePreview && (
            <rect
              data-testid="move-preview"
              x={movePreview.x}
              y={movePreview.y}
              width={movePreview.width}
              height={movePreview.height}
              fill="#2563eb"
              fillOpacity={0.1}
              stroke="#2563eb"
              strokeWidth={1.5 / view.scale}
              strokeDasharray={6 / view.scale}
              pointerEvents="none"
            />
          )}
          {/* AI 非阻塞：本轮生成中 AI 正在编辑的元素——蓝色虚线呼吸框，不可交互 */}
          {aiLockedIds.map((id) => {
            const e = doc.elements.find((x) => x.id === id);
            if (!e) return null;
            const b = elementBounds(e);
            // 与 SelectionOverlay 一致：boundsOf 是未旋转 bbox，旋转中心取 bbox 中心（旋转后虚线框仍贴合元素）
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const rot = e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined;
            return (
              <rect
                key={id}
                className="ai-lock-overlay"
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                transform={rot}
                pointerEvents="none"
              />
            );
          })}
          <SelectionOverlay scale={view.scale} startTouchArrow={startTouchArrow} />
          {editing && <TextEditor id={editing.id} x={editing.x} y={editing.y} />}
        </g>
        {rubber && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
            <rect x={rubber.x} y={rubber.y} width={rubber.width} height={rubber.height} fill="#2563eb22" stroke="#2563eb" strokeWidth={1} />
          </g>
        )}
        {/* 锚点候选层：箭头/线条工具悬停/绘制中，或逻辑触点拉箭头拖动中（preview.type === "arrow"） */}
        {(tool === "arrow" || tool === "line" || preview?.type === "arrow" || preview?.type === "line") && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`} pointerEvents="none">
            {doc.elements.flatMap((e) => logicAnchors(e)).map((a) => {
              const active = anchorHint?.id === a.id;
              return (
                <circle
                  key={a.id}
                  data-anchor-layer={a.side}
                  data-element-id={a.elementId}
                  data-active={active ? "true" : undefined}
                  cx={a.x}
                  cy={a.y}
                  r={4 / view.scale}
                  fill={active ? "#2563eb" : "none"}
                  stroke="#2563eb"
                  strokeWidth={1.5 / view.scale}
                  opacity={0.7}
                />
              );
            })}
          </g>
        )}
      </svg>
      </div>
      {styleMenu && <CanvasStyleMenu x={styleMenu.x} y={styleMenu.y} onClose={closeStyleMenu} />}
      {arrowMenu && <ArrowContextMenu menu={arrowMenu} onClose={closeArrowMenu} />}
    </div>
  );
}
