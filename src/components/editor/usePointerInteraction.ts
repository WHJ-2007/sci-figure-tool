import { useRef, useState, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { snapRect } from "@/lib/canvas/geometry";
import type { ShapeType } from "@/lib/canvas/types";

type Mode =
  | { kind: "idle" }
  | { kind: "move"; startX: number; startY: number; start: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: "rubber"; startX: number; startY: number; x: number; y: number }
  | { kind: "resize"; id: string; handle: string; startX: number; startY: number; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "rotate"; id: string; cx: number; cy: number }
  | { kind: "draw-shape"; tool: ShapeType | "rounded"; startX: number; startY: number; x: number; y: number }
  | { kind: "draw-line"; tool: "arrow" | "polyline"; startX: number; startY: number; points: { x: number; y: number }[] };

export type DrawPreview =
  | { type: ShapeType | "rounded"; x: number; y: number; width: number; height: number }
  | { type: "arrow" | "polyline"; points: { x: number; y: number }[] };

export function usePointerInteraction(worldX: (c: number) => number, worldY: (c: number) => number) {
  const modeRef = useRef<Mode>({ kind: "idle" });
  const [rubber, setRubber] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<DrawPreview | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const s = useCanvasStore.getState();
      if (s.isGenerating) return;
      const wx = worldX(e.clientX);
      const wy = worldY(e.clientY);
      if (s.tool !== "select") {
        if (s.tool === "text") {
          // 编辑中再点击不放新字（否则双击会堆叠创建两个空文字）
          if (s.editingText) return;
          const el = makeElement("text", wx, wy - 8, 60, 22, { text: "" });
          s.addElement(el);
          modeRef.current = { kind: "idle" };
          s.setEditingText(el.id);
          return;
        }
        if (s.tool === "arrow" || s.tool === "polyline") {
          modeRef.current = { kind: "draw-line", tool: s.tool, startX: wx, startY: wy, points: [{ x: wx, y: wy }] };
          return;
        }
        modeRef.current = { kind: "draw-shape", tool: s.tool as ShapeType | "rounded", startX: wx, startY: wy, x: wx, y: wy };
        return;
      }
      const target = (e.target as Element).closest("[data-element-id]");
      if (target) {
        const id = target.getAttribute("data-element-id")!;
        const el = s.doc.elements.find((x) => x.id === id);
        if (el && s.tool === "select") {
          const next = s.selection.includes(id) ? s.selection : [id];
          if (!s.selection.includes(id)) s.setSelection([id]);
          const start = new Map<string, { x: number; y: number }>();
          for (const eid of next) {
            const ee = s.doc.elements.find((x) => x.id === eid);
            if (ee) start.set(eid, { x: ee.x, y: ee.y });
          }
          modeRef.current = { kind: "move", startX: wx, startY: wy, start, moved: false };
          return;
        }
      }
      if (s.tool === "select") {
        modeRef.current = { kind: "rubber", startX: wx, startY: wy, x: wx, y: wy };
      }
    },
    [worldX, worldY]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const m = modeRef.current;
      const wx = worldX(e.clientX);
      const wy = worldY(e.clientY);
      if (m.kind === "move") {
        const dx = wx - m.startX;
        const dy = wy - m.startY;
        if (!m.moved && Math.hypot(dx, dy) < 3) return;
        if (!m.moved) {
          // 首次实际移动前提交历史快照（手势前状态），一次拖动 = 一步撤销
          m.moved = true;
          useCanvasStore.getState().commitHistory();
        }
        const s = useCanvasStore.getState();
        // 群组吸附：用选中集整体 bbox 的最小边对齐
        const moving = s.doc.elements.filter((el) => m.start.has(el.id));
        const boxes = moving.map((el) => ({ x: el.x + dx, y: el.y + dy, width: el.width, height: el.height }));
        const minX = Math.min(...boxes.map((b) => b.x));
        const minY = Math.min(...boxes.map((b) => b.y));
        const others = s.doc.elements.filter((el) => !m.start.has(el.id));
        const snap = snapRect({ x: minX, y: minY, width: 0, height: 0 }, others);
        // moveElements 不入历史（首次移动时已 commitHistory 一次）
        s.moveElements([...m.start.keys()], dx + snap.dx, dy + snap.dy);
      } else if (m.kind === "rubber") {
        m.x = wx;
        m.y = wy;
        setRubber({
          x: Math.min(m.startX, m.x),
          y: Math.min(m.startY, m.y),
          width: Math.abs(m.x - m.startX),
          height: Math.abs(m.y - m.startY),
        });
      } else if (m.kind === "draw-shape") {
        m.x = wx;
        m.y = wy;
        setPreview({
          type: m.tool,
          x: Math.min(m.startX, m.x),
          y: Math.min(m.startY, m.y),
          width: Math.abs(m.x - m.startX),
          height: Math.abs(m.y - m.startY),
        });
      } else if (m.kind === "draw-line") {
        // 保持 [起点, 当前指针] 两个点：首帧补上当前点，后续替换末点，polyline 最终恰好 2 点
        if (m.points.length < 2) m.points.push({ x: wx, y: wy });
        else m.points[m.points.length - 1] = { x: wx, y: wy };
        setPreview({ type: m.tool, points: [...m.points] });
      }
    },
    [worldX, worldY]
  );

  const onPointerUp = useCallback(() => {
    const m = modeRef.current;
    const s = useCanvasStore.getState();
    if (m.kind === "rubber") {
      const r = {
        x: Math.min(m.startX, m.x),
        y: Math.min(m.startY, m.y),
        width: Math.abs(m.x - m.startX),
        height: Math.abs(m.y - m.startY),
      };
      if (r.width < 3 && r.height < 3) {
        s.setSelection([]);
      } else {
        const hit = s.doc.elements
          .filter((el) => {
            const b = { x: el.x, y: el.y, width: el.width, height: el.height };
            return b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
          })
          .map((el) => el.id);
        s.setSelection(hit);
      }
      setRubber(null);
    } else if (m.kind === "draw-shape") {
      const w = Math.abs(m.x - m.startX);
      const h = Math.abs(m.y - m.startY);
      if (w >= 4 && h >= 4) {
        const st = useCanvasStore.getState();
        const el = makeElement(m.tool, Math.min(m.startX, m.x), Math.min(m.startY, m.y), w, h);
        st.addElement(el);
        st.setSelection([el.id]);
      }
      setPreview(null);
    } else if (m.kind === "draw-line") {
      if (m.points.length >= 2) {
        const st = useCanvasStore.getState();
        const p0 = m.points[0];
        const last = m.points[m.points.length - 1];
        // arrow 用 x/y/width/height 表示线（width/height 为终点相对偏移）；polyline 存 points
        const el =
          m.tool === "arrow"
            ? makeElement("arrow", p0.x, p0.y, last.x - p0.x, last.y - p0.y)
            : makeElement("polyline", p0.x, p0.y, 0, 0, { points: m.points });
        st.addElement(el);
        st.setSelection([el.id]);
      }
      setPreview(null);
    }
    modeRef.current = { kind: "idle" };
  }, []);

  return { rubber, preview, onPointerDown, onPointerMove, onPointerUp, modeRef };
}
