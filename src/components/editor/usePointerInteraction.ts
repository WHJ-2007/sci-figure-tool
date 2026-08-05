import { useRef, useState, useCallback, useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { snapRect, nearestAnchor } from "@/lib/canvas/geometry";
import type { ShapeType } from "@/lib/canvas/types";
import type { Anchor } from "@/lib/canvas/geometry";

type Mode =
  | { kind: "idle" }
  | { kind: "pan"; startClientX: number; startClientY: number; ox0: number; oy0: number }
  | { kind: "move"; startX: number; startY: number; start: Map<string, { x: number; y: number }>; moved: boolean; lastDx: number; lastDy: number }
  | { kind: "rubber"; startX: number; startY: number; x: number; y: number; additive: boolean }
  | { kind: "resize"; id: string; handle: string; startX: number; startY: number; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "rotate"; id: string; cx: number; cy: number }
  | { kind: "draw-shape"; tool: ShapeType | "rounded" | "logic"; startX: number; startY: number; x: number; y: number }
  | { kind: "draw-line"; tool: "arrow" | "polyline"; startX: number; startY: number; points: { x: number; y: number }[]; sourceId?: string };

export type DrawPreview =
  | { type: ShapeType | "rounded" | "logic"; x: number; y: number; width: number; height: number }
  | { type: "arrow" | "polyline"; points: { x: number; y: number }[] };

export function usePointerInteraction(worldX: (c: number) => number, worldY: (c: number) => number) {
  const modeRef = useRef<Mode>({ kind: "idle" });
  const [rubber, setRubber] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [panning, setPanning] = useState(false);
  // 箭头工具下高亮的最近锚点（悬停或绘制吸附时）
  const [anchorHint, setAnchorHint] = useState<Anchor | null>(null);

  // 拖动/绘制期间的全局指针跟踪：事件挂在 window 上——指针移出画布甚至移出窗口，
  // 浏览器仍把 pointermove 派发给 window，元素持续跟随鼠标（"要时刻检测鼠标位置"）。
  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const m = modeRef.current;
      const wx = worldX(e.clientX);
      const wy = worldY(e.clientY);
      if (m.kind === "pan") {
        const s = useCanvasStore.getState();
        s.setView({ scale: s.view.scale, ox: m.ox0 + (e.clientX - m.startClientX), oy: m.oy0 + (e.clientY - m.startClientY) });
      } else if (m.kind === "move") {
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
        // 绝对目标 = 按下位置 + 指针位移 + 吸附偏移；moveElements 是相对移动，
        // 每次只移动与上次的差值，否则连续 move 事件会累计放大（图形甩出鼠标位置）
        const tx = dx + snap.dx;
        const ty = dy + snap.dy;
        s.moveElements([...m.start.keys()], tx - m.lastDx, ty - m.lastDy);
        m.lastDx = tx;
        m.lastDy = ty;
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
        // 保持 [起点, 当前指针] 两个点：首帧补上当前点，后续替换末点，polyline 最终恰好 2 点；
        // 箭头终点吸附到最近锚点（12px 内），吸附时高亮该锚点
        const s = useCanvasStore.getState();
        let ex = wx;
        let ey = wy;
        let hint: Anchor | null = null;
        if (m.tool === "arrow") {
          // 触点拉箭头（sourceId 存在）时排除源节点自身锚点：箭头拖回源附近不会吸回起点
          hint = nearestAnchor(s.doc.elements, { x: wx, y: wy }, undefined, m.sourceId);
          if (hint) {
            ex = hint.x;
            ey = hint.y;
          }
        }
        setAnchorHint(hint);
        if (m.points.length < 2) m.points.push({ x: ex, y: ey });
        else m.points[m.points.length - 1] = { x: ex, y: ey };
        setPreview({ type: m.tool, points: [...m.points] });
      }
    },
    [worldX, worldY]
  );

  const endDrag = useCallback(() => {
    const m = modeRef.current;
    const s = useCanvasStore.getState();
    if (m.kind === "pan") {
      setPanning(false);
    } else if (m.kind === "rubber") {
      const r = {
        x: Math.min(m.startX, m.x),
        y: Math.min(m.startY, m.y),
        width: Math.abs(m.x - m.startX),
        height: Math.abs(m.y - m.startY),
      };
      if (r.width < 3 && r.height < 3) {
        if (!m.additive) s.setSelection([]);
      } else {
        const hit = s.doc.elements
          .filter((el) => {
            const b = { x: el.x, y: el.y, width: el.width, height: el.height };
            return b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
          })
          .map((el) => el.id);
        if (m.additive) s.setSelection([...new Set([...s.selection, ...hit])]);
        else s.setSelection(hit);
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
        // arrow 用 x/y/width/height 表示线（width/height 为终点相对偏移）；polyline 存 points。
        // 端点已吸附到锚点（起点按下时、终点移动时），落点即锚点位置 → 反查记录 startId/endId
        const el =
          m.tool === "arrow"
            ? makeElement("arrow", p0.x, p0.y, last.x - p0.x, last.y - p0.y, {
                startId: nearestAnchor(st.doc.elements, p0)?.elementId,
                endId: nearestAnchor(st.doc.elements, last, undefined, m.sourceId)?.elementId,
              })
            : makeElement("polyline", p0.x, p0.y, 0, 0, { points: m.points });
        st.addElement(el);
        st.setSelection([el.id]);
      }
      setPreview(null);
    }
    modeRef.current = { kind: "idle" };
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }, [onWindowMove]);

  const startDrag = useCallback(() => {
    // 先移除再挂载，保证幂等（重复 pointerdown 不叠加监听）
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }, [onWindowMove, endDrag]);

  // 逻辑节点触点：从锚点位置直接拉出箭头（起点精确落在锚点上，拖动中吸附其他锚点）
  const startTouchArrow = useCallback(
    (anchor: Anchor) => {
      const s = useCanvasStore.getState();
      if (s.isGenerating || s.tool === "hand") return;
      modeRef.current = {
        kind: "draw-line",
        tool: "arrow",
        startX: anchor.x,
        startY: anchor.y,
        points: [{ x: anchor.x, y: anchor.y }],
        sourceId: anchor.elementId,
      };
      setAnchorHint(anchor);
      startDrag();
    },
    [startDrag]
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    },
    [onWindowMove, endDrag]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const s = useCanvasStore.getState();
      if (s.isGenerating) return;
      if (s.tool === "hand") {
        modeRef.current = { kind: "pan", startClientX: e.clientX, startClientY: e.clientY, ox0: s.view.ox, oy0: s.view.oy };
        setPanning(true);
        startDrag();
        return;
      }
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
          // 箭头起点吸附到逻辑节点锚点：起点落在锚点附近 12px 内则精确对齐（记录锚点 id 供 arrow 的 startId）
          const startAnchor = s.tool === "arrow" ? nearestAnchor(s.doc.elements, { x: wx, y: wy }) : null;
          const sx = startAnchor ? startAnchor.x : wx;
          const sy = startAnchor ? startAnchor.y : wy;
          modeRef.current = { kind: "draw-line", tool: s.tool, startX: sx, startY: sy, points: [{ x: sx, y: sy }] };
          setAnchorHint(startAnchor);
          startDrag();
          return;
        }
        modeRef.current = { kind: "draw-shape", tool: s.tool as ShapeType | "rounded" | "logic", startX: wx, startY: wy, x: wx, y: wy };
        startDrag();
        return;
      }
      const target = (e.target as Element).closest("[data-element-id]");
      if (target) {
        const id = target.getAttribute("data-element-id")!;
        const el = s.doc.elements.find((x) => x.id === id);
        if (el && s.tool === "select") {
          // Shift 只追加（点击已选元素保持选区）：toggle 移除会让"点已选元素拖动"变成该元素
          // 原地不动、其他元素在动（用户报的"拖动乱动"）。取消选择走空白点击清空。
          const next = s.selection.includes(id) ? s.selection : e.shiftKey ? [...s.selection, id] : [id];
          if (!s.selection.includes(id)) s.setSelection(next);
          const start = new Map<string, { x: number; y: number }>();
          for (const eid of next) {
            const ee = s.doc.elements.find((x) => x.id === eid);
            if (ee) start.set(eid, { x: ee.x, y: ee.y });
          }
          modeRef.current = { kind: "move", startX: wx, startY: wy, start, moved: false, lastDx: 0, lastDy: 0 };
          startDrag();
          return;
        }
      }
      if (s.tool === "select") {
        modeRef.current = { kind: "rubber", startX: wx, startY: wy, x: wx, y: wy, additive: e.shiftKey };
        startDrag();
      }
    },
    [worldX, worldY, startDrag]
  );

  // svg 上的 move/up 只处理空闲态（箭头悬停锚点高亮）；活动模式一律由 window 监听处理
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (modeRef.current.kind !== "idle") return;
      const s = useCanvasStore.getState();
      setAnchorHint(s.tool === "arrow" ? nearestAnchor(s.doc.elements, { x: worldX(e.clientX), y: worldY(e.clientY) }) : null);
    },
    [worldX, worldY]
  );

  const onPointerUp = useCallback(() => {}, []);

  return { rubber, preview, panning, anchorHint, onPointerDown, onPointerMove, onPointerUp, modeRef, startTouchArrow };
}
