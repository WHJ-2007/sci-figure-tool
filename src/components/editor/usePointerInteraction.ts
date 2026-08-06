import { useRef, useState, useCallback, useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { snapRect, nearestAnchor, hitTestElement, elementBounds } from "@/lib/canvas/geometry";
import type { ShapeType } from "@/lib/canvas/types";
import type { Anchor } from "@/lib/canvas/geometry";

// 拖动松手后的补间动画时长（ease-out）：预览框消失、元素从原位平滑滑到目标落点
const MOVE_ANIMATION_MS = 150;

type Mode =
  | { kind: "idle" }
  | { kind: "pan"; startClientX: number; startClientY: number; ox0: number; oy0: number }
  | { kind: "move"; startX: number; startY: number; start: Map<string, { x: number; y: number }>; moved: boolean; lastDx: number; lastDy: number }
  | { kind: "rubber"; startX: number; startY: number; x: number; y: number; additive: boolean }
  | { kind: "resize"; id: string; handle: string; startX: number; startY: number; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "rotate"; id: string; cx: number; cy: number }
  | { kind: "draw-shape"; tool: ShapeType | "rounded" | "logic" | "text"; startX: number; startY: number; x: number; y: number }
  | { kind: "draw-line"; tool: "arrow" | "polyline" | "line"; startX: number; startY: number; points: { x: number; y: number }[]; sourceId?: string }
  // 箭头/线条两点制：起点已定（原地点击），等待第二次点击作为终点；预览跟随指针
  | { kind: "arrow-wait"; tool: "arrow" | "line"; startX: number; startY: number; sourceId?: string; startAnchorId?: string };

export type DrawPreview =
  | { type: ShapeType | "rounded" | "logic" | "text"; x: number; y: number; width: number; height: number }
  | { type: "arrow" | "polyline" | "line"; points: { x: number; y: number }[] };

export function usePointerInteraction(worldX: (c: number) => number, worldY: (c: number) => number) {
  const modeRef = useRef<Mode>({ kind: "idle" });
  const [rubber, setRubber] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [panning, setPanning] = useState(false);
  const tool = useCanvasStore((s) => s.tool);
  // 箭头工具下高亮的最近锚点（悬停或绘制吸附时）
  const [anchorHint, setAnchorHint] = useState<Anchor | null>(null);
  // 拖动预览：被拖动元素半透明留在原位（ghost），虚线预览框显示含吸附的目标落点；松手后补间动画到位
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [movePreview, setMovePreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // 右键手势跟踪：右键空白按下即记（rubber 起点），拖拽过则标记 dragged——
  // Canvas 的 contextmenu 据此区分「右键点击弹画布样式菜单」与「右键拖拽多选后不弹」
  const lastRightClickRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  // 切走箭头/线条工具时取消待定起点（否则残留预览会跟着别的工具）
  useEffect(() => {
    if (tool !== "arrow" && tool !== "line" && modeRef.current.kind === "arrow-wait") {
      modeRef.current = { kind: "idle" };
      setPreview(null);
      setAnchorHint(null);
    }
  }, [tool]);

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
        const xs = moving.map((el) => el.x);
        const ys = moving.map((el) => el.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...moving.map((el) => el.x + el.width));
        const maxY = Math.max(...moving.map((el) => el.y + el.height));
        const others = s.doc.elements.filter((el) => !m.start.has(el.id));
        const snap = snapRect({ x: minX + dx, y: minY + dy, width: 0, height: 0 }, others);
        // 绝对目标 = 按下位置 + 指针位移 + 吸附偏移
        const tx = dx + snap.dx;
        const ty = dy + snap.dy;
        m.lastDx = tx;
        m.lastDy = ty;
        // 拖动预览：元素本体半透明留在原位（ghost），虚线预览框显示含吸附的目标落点
        setMovingIds([...m.start.keys()]);
        setMovePreview({ x: minX + tx, y: minY + ty, width: maxX - minX, height: maxY - minY });
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
        // 箭头/线条终点吸附到最近锚点（12px 内），吸附时高亮该锚点
        const s = useCanvasStore.getState();
        let ex = wx;
        let ey = wy;
        let hint: Anchor | null = null;
        if (m.tool === "arrow" || m.tool === "line") {
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

  const endDrag = useCallback(
    (e: PointerEvent) => {
      const m = modeRef.current;
      const s = useCanvasStore.getState();
      if (m.kind === "pan") {
        // 平移只会在无选区时启动（空白按下时已有选区 = 取消选择，不起 pan）；
        // 清空选择的动作在 pointerdown 完成，这里只需要收尾
        setPanning(false);
      } else if (m.kind === "move") {
        // 松手：元素本体（ghost 原位）→ rAF 补间动画平滑滑到目标落点（预览框位置），ease-out 约 150ms
        setMovingIds([]);
        setMovePreview(null);
        if (m.moved) {
          const st = useCanvasStore.getState();
          const ids = [...m.start.keys()];
          const dx = m.lastDx;
          const dy = m.lastDy;
          const t0 = performance.now();
          let prev = 0;
          // 用 performance.now() 而非 rAF 回调的时间戳：jsdom 的 rAF 时间戳与 performance.now 零点
          // 不一致（恒负 → 永不到 1 的循环），浏览器里两者等价
          const step = () => {
            const t = Math.min(1, (performance.now() - t0) / MOVE_ANIMATION_MS);
            const eased = 1 - Math.pow(1 - t, 3);
            useCanvasStore.getState().moveElements(ids, (eased - prev) * dx, (eased - prev) * dy);
            prev = eased;
            if (t < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      } else if (m.kind === "rubber") {
        const r = {
          x: Math.min(m.startX, m.x),
          y: Math.min(m.startY, m.y),
          width: Math.abs(m.x - m.startX),
          height: Math.abs(m.y - m.startY),
        };
        if (r.width >= 3 || r.height >= 3) {
          // 右键拖拽 = 多选框选：标记 dragged，松手后的 contextmenu 不弹画布样式菜单
          if (lastRightClickRef.current) lastRightClickRef.current.dragged = true;
        }
        if (r.width < 3 && r.height < 3) {
          if (!m.additive) s.setSelection([]);
        } else {
          const hit = s.doc.elements
            .filter((el) => {
              // AI 非阻塞：锁定元素不进框选结果
              if (s.aiLockedIds.includes(el.id)) return false;
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
          if (m.tool === "text") {
            // 文字工具拖动出文本框：保留拖动框尺寸，创建后立即进入编辑（文字宽度在提交时自适应）
            const el = makeElement("text", Math.min(m.startX, m.x), Math.min(m.startY, m.y), w, h, { text: "" });
            el.width = w;
            el.height = h;
            st.addElement(el);
            st.setSelection([el.id]);
            st.setEditingText(el.id);
          } else {
            const el = makeElement(m.tool, Math.min(m.startX, m.x), Math.min(m.startY, m.y), w, h);
            st.addElement(el);
            st.setSelection([el.id]);
          }
        }
        setPreview(null);
      } else if (m.kind === "draw-line") {
        const st = useCanvasStore.getState();
        const p0 = m.points[0];
        const last = m.points[m.points.length - 1];
        if (m.tool === "arrow" || m.tool === "line") {
          // 两点制：拖拽（移动足够距离）直接成图；原地点击转为等待第二次点击
          // arrow 用 x/y/width/height 表示线（width/height 为终点相对偏移）；line = arrow + head:"none"。
          // 端点已吸附到锚点（起点按下时、终点移动时），落点即锚点位置 → 反查记录 startId/endId
          if (m.points.length >= 2 && Math.hypot(last.x - p0.x, last.y - p0.y) >= 4) {
            const el = makeElement("arrow", p0.x, p0.y, last.x - p0.x, last.y - p0.y, {
              startId: nearestAnchor(st.doc.elements, p0)?.elementId,
              endId: nearestAnchor(st.doc.elements, last, undefined, m.sourceId)?.elementId,
              head: m.tool === "line" ? "none" : undefined,
            });
            st.addElement(el);
            st.setSelection([el.id]);
            setPreview(null);
          } else {
            modeRef.current = {
              kind: "arrow-wait",
              tool: m.tool,
              startX: p0.x,
              startY: p0.y,
              sourceId: m.sourceId,
              startAnchorId: nearestAnchor(st.doc.elements, p0)?.elementId,
            };
            setPreview({ type: m.tool, points: [p0, { x: last.x, y: last.y }] });
            setAnchorHint(null);
          }
        } else if (m.points.length >= 2) {
          const el = makeElement("polyline", p0.x, p0.y, 0, 0, { points: m.points });
          st.addElement(el);
          st.setSelection([el.id]);
          setPreview(null);
        }
      }
      if (modeRef.current.kind !== "arrow-wait") modeRef.current = { kind: "idle" };
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    },
    [onWindowMove]
  );

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
      // AI 非阻塞：AI 正在编辑的元素锁定——触点不可拉箭头
      if (s.aiLockedIds.includes(anchor.elementId)) return;
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
      const wx = worldX(e.clientX);
      const wy = worldY(e.clientY);
      if (s.tool !== "select") {
        if (s.tool === "arrow" || s.tool === "polyline" || s.tool === "line") {
          if ((s.tool === "arrow" || s.tool === "line") && modeRef.current.kind === "arrow-wait") {
            // 两点制第二击：起点已定，点击处为终点（吸附逻辑节点锚点）；右键取消待定起点
            if (e.button === 2) {
              modeRef.current = { kind: "idle" };
              setPreview(null);
              setAnchorHint(null);
              return;
            }
            const wait = modeRef.current;
            const endAnchor = nearestAnchor(s.doc.elements, { x: wx, y: wy }, undefined, wait.sourceId);
            const ex = endAnchor ? endAnchor.x : wx;
            const ey = endAnchor ? endAnchor.y : wy;
            if (Math.hypot(ex - wait.startX, ey - wait.startY) >= 4) {
              const el = makeElement("arrow", wait.startX, wait.startY, ex - wait.startX, ey - wait.startY, {
                startId: wait.startAnchorId,
                endId: endAnchor?.elementId,
                head: wait.tool === "line" ? "none" : undefined,
              });
              s.addElement(el);
              s.setSelection([el.id]);
            }
            modeRef.current = { kind: "idle" };
            setPreview(null);
            setAnchorHint(null);
            return;
          }
          if (e.button === 2) return; // 箭头/线条工具右键不绘制
          // 箭头/线条起点吸附到逻辑节点锚点：起点落在锚点附近 12px 内则精确对齐（记录锚点 id 供 arrow 的 startId）
          const startAnchor = s.tool === "arrow" || s.tool === "line" ? nearestAnchor(s.doc.elements, { x: wx, y: wy }) : null;
          const sx = startAnchor ? startAnchor.x : wx;
          const sy = startAnchor ? startAnchor.y : wy;
          modeRef.current = { kind: "draw-line", tool: s.tool as "arrow" | "polyline" | "line", startX: sx, startY: sy, points: [{ x: sx, y: sy }] };
          setAnchorHint(startAnchor);
          startDrag();
          return;
        }
        // 文字工具：拖动出文本框（拖出足够大的框才创建并进入编辑），不再点击即建
        if (s.tool === "text" && s.editingText) return; // 编辑中再点击不放新字（否则双击会堆叠创建两个空文字）
        modeRef.current = { kind: "draw-shape", tool: s.tool as ShapeType | "rounded" | "logic" | "text", startX: wx, startY: wy, x: wx, y: wy };
        startDrag();
        return;
      }
      const target = (e.target as Element).closest("[data-element-id]");
      if (target) {
        const id = target.getAttribute("data-element-id")!;
        const el = s.doc.elements.find((x) => x.id === id);
        // AI 非阻塞：本轮生成中 AI 正在编辑的元素锁定——不可选中/拖动/编辑
        if (s.aiLockedIds.includes(id)) return;
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
        if (e.button === 2) {
          // 右键落在任意箭头上不进多选框选：交给 contextmenu 选中并处理折点增删
          // （否则右键点击会在 pointerup 清空选择，折点操作找不到目标）
          // DOM 命中优先（真实点击命中元素节点）；几何兜底（测试直接派发到 svg 节点）
          const t = (e.target as Element).closest("[data-element-id]");
          const tid = t?.getAttribute("data-element-id") ?? null;
          const tel = tid ? s.doc.elements.find((x) => x.id === tid) : null;
          const onArrow =
            (tel?.type === "arrow" && !s.aiLockedIds.includes(tid!)) ||
            s.doc.elements.some(
              (x) => x.type === "arrow" && !s.aiLockedIds.includes(x.id) && hitTestElement(x, { x: wx, y: wy }, 14 / s.view.scale)
            );
          if (onArrow) return;
          // 右键拖动 = 多选框选（原 rubber 逻辑）
          modeRef.current = { kind: "rubber", startX: wx, startY: wy, x: wx, y: wy, additive: e.shiftKey };
          lastRightClickRef.current = { x: wx, y: wy, dragged: false };
          startDrag();
        } else if (e.button === 0) {
          // 选中单个箭头时：蓝色虚线框（bbox）内的左键任意处按下 = 整体移动箭头（线外的空白才取消选择）；
          // 再泛化到有选区的普通空白：按下即取消选择（拖动语义只属于元素本身，空白不再平移画布；shift 保留）
          if (s.selection.length === 1) {
            const only = s.doc.elements.find((x) => x.id === s.selection[0]);
            if (only && only.type === "arrow" && !s.aiLockedIds.includes(only.id)) {
              const b = elementBounds(only);
              if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) {
                const start = new Map<string, { x: number; y: number }>([[only.id, { x: only.x, y: only.y }]]);
                modeRef.current = { kind: "move", startX: wx, startY: wy, start, moved: false, lastDx: 0, lastDy: 0 };
                startDrag();
                return;
              }
            }
          }
          if (s.selection.length > 0) {
            if (!e.shiftKey) s.setSelection([]);
            return;
          }
          modeRef.current = { kind: "pan", startClientX: e.clientX, startClientY: e.clientY, ox0: s.view.ox, oy0: s.view.oy };
          setPanning(true);
          startDrag();
        }
      }
    },
    [worldX, worldY, startDrag]
  );

  // svg 上的 move/up 只处理空闲态（箭头悬停锚点高亮、两点制预览跟随）；活动模式一律由 window 监听处理
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const m = modeRef.current;
      if (m.kind === "arrow-wait") {
        // 两点制：预览 = 起点 → 当前指针（终点吸附逻辑节点锚点并高亮）
        const s = useCanvasStore.getState();
        let ex = worldX(e.clientX);
        let ey = worldY(e.clientY);
        const hint = nearestAnchor(s.doc.elements, { x: ex, y: ey }, undefined, m.sourceId);
        if (hint) {
          ex = hint.x;
          ey = hint.y;
        }
        setAnchorHint(hint);
        setPreview({ type: m.tool, points: [{ x: m.startX, y: m.startY }, { x: ex, y: ey }] });
        return;
      }
      if (m.kind !== "idle") return;
      const s = useCanvasStore.getState();
      setAnchorHint(s.tool === "arrow" || s.tool === "line" ? nearestAnchor(s.doc.elements, { x: worldX(e.clientX), y: worldY(e.clientY) }) : null);
    },
    [worldX, worldY]
  );

  const onPointerUp = useCallback(() => {}, []);

  return { rubber, preview, panning, anchorHint, movingIds, movePreview, onPointerDown, onPointerMove, onPointerUp, modeRef, startTouchArrow, lastRightClickRef };
}
