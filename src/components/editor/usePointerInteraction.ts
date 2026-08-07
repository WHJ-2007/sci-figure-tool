import { useRef, useState, useCallback, useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { recognizeArrow } from "@/lib/canvas/handwriting";
import { snapRect, nearestAnchor, hitTestElement, elementBounds, alignmentGuides, distToSegment, logicAnchors, type AlignGuides } from "@/lib/canvas/geometry";
import { niceScale, PLOT } from "@/lib/canvas/chartLayout";
import type { CanvasDocument, CanvasElement, ShapeType } from "@/lib/canvas/types";
import type { Anchor } from "@/lib/canvas/geometry";

// 角度差归一化到 (-π, π]：跨 0 点拖动不跳变
function normRad(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

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
  // 画笔（自由手绘）：连续采样点列，松手创建 pen 元素；$1 识别命中箭头 → 替换为规整箭头（一步撤销复原手写）
  | { kind: "draw-pen"; points: { x: number; y: number }[] }
  | { kind: "draw-line"; tool: "arrow" | "polyline" | "line"; startX: number; startY: number; points: { x: number; y: number }[]; sourceId?: string }
  // C 图表联动：拖动扇形/柱体本体改数据（圆周方向拖 = 改扇角，垂直拖 = 改柱高）；
  // 拖动中实时更新数据与被拖元素（不入历史），松手 recomputeChart 整图重排 = 一步撤销
  | { kind: "chart-edit"; chartId: string; role: "slice" | "bar"; index: number; startY: number; startValue: number; startSweep: number; lastAngle: number; sweep: number; moved: boolean; yMax: number; baseline: CanvasDocument }
  // 箭头/线条两点制：起点已定（原地点击），等待第二次点击作为终点；预览跟随指针
  | { kind: "arrow-wait"; tool: "arrow" | "line"; startX: number; startY: number; sourceId?: string; startAnchorId?: string };

export type DrawPreview =
  | { type: ShapeType | "rounded" | "logic" | "text"; x: number; y: number; width: number; height: number }
  | { type: "arrow" | "polyline" | "line"; points: { x: number; y: number }[] }
  | { type: "pen"; points: { x: number; y: number }[] };

// 图表关键节点命中：饼图 = 扇形起始角半径线（接缝），柱状图 = 柱顶边缘。
// 命中关键节点才进入"拖比例"；拖图表本体 = 整体移动（用户：默认拖动整图，悬浮接缝改比例）
function isChartSeam(el: CanvasElement, wx: number, wy: number): boolean {
  const tol = 10; // 世界坐标容差
  if (el.type === "sector" && el.bind?.role === "slice") {
    // 接缝 = 圆心 → 起始角边缘点的半径线
    const r = el.radius;
    const p1 = { x: el.x, y: el.y };
    const p2 = { x: el.x + r * Math.cos(el.startAngle), y: el.y + r * Math.sin(el.startAngle) };
    return distToSegment({ x: wx, y: wy }, p1, p2) <= tol;
  }
  if (el.type === "rect" && el.bind?.role === "bar") {
    // 柱顶 = 柱体上边缘
    return Math.abs(wy - el.y) <= tol && wx >= el.x - tol && wx <= el.x + el.width + tol;
  }
  return false;
}

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
  // PPT 式对齐参考线：拖动到与其他元素边缘/中心对齐的位置时显示非阻塞提示线（世界坐标）
  const [alignGuides, setAlignGuides] = useState<AlignGuides | null>(null);
  // 移动已有箭头：显示其他逻辑节点的箭头锚点候选（头尾可吸附），吸附中的锚点高亮
  const [arrowMoveAnchors, setArrowMoveAnchors] = useState<Anchor[] | null>(null);
  // 图表关键节点悬停（饼图接缝 / 柱顶）：光标变特殊形状，提示"可拖比例而非移动整图"
  const [seamHover, setSeamHover] = useState(false);
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
        // 群组吸附：用选中集整体 bbox 的最小边对齐。
        // 基准必须始终是"按下时的包围盒"：元素每帧已随 moveElements 增量移动，
        // 若直接取当前包围盒 + 自按下的位移，基准会随拖动漂移，本体跟手错位
        const moving = s.doc.elements.filter((el) => m.start.has(el.id));
        const bounds = moving.map((el) => {
          const b = elementBounds(el);
          return { x: b.x - m.lastDx, y: b.y - m.lastDy, width: b.width, height: b.height };
        });
        const minX = Math.min(...bounds.map((b) => b.x));
        const minY = Math.min(...bounds.map((b) => b.y));
        const maxX = Math.max(...bounds.map((b) => b.x + b.width));
        const maxY = Math.max(...bounds.map((b) => b.y + b.height));
        const others = s.doc.elements.filter((el) => !m.start.has(el.id));
        const snap = snapRect({ x: minX + dx, y: minY + dy, width: 0, height: 0 }, others);
        // 绝对目标 = 按下位置 + 指针位移 + 吸附偏移
        let tx = dx + snap.dx;
        let ty = dy + snap.dy;
        // 移动单个箭头：头尾显示其他逻辑节点的箭头锚点候选并可吸附（与绘制箭头同阈值）；
        // 头尾也用"按下时位置 + 目标位移"（当前元素位置已含已移动增量，直接加 tx 会双重累计）
        const singleArrow = moving.length === 1 && moving[0].type === "arrow" ? moving[0] : null;
        if (singleArrow) {
          const candidates = others.flatMap((el) => logicAnchors(el));
          setArrowMoveAnchors(candidates);
          // 头 = 终点（x+width, y+height），尾 = 起点 (x, y)；优先头部吸附，头部无候选再吸尾部
          const head = { x: singleArrow.x - m.lastDx + singleArrow.width + tx, y: singleArrow.y - m.lastDy + singleArrow.height + ty };
          const tail = { x: singleArrow.x - m.lastDx + tx, y: singleArrow.y - m.lastDy + ty };
          const headHit = nearestAnchor(others, head, 12, singleArrow.id);
          const tailHit = nearestAnchor(others, tail, 12, singleArrow.id);
          const hit = headHit ?? tailHit;
          if (hit) {
            const target = headHit ? head : tail;
            tx += hit.x - target.x;
            ty += hit.y - target.y;
            setAnchorHint(hit);
          } else {
            setAnchorHint(null);
          }
        } else {
          setArrowMoveAnchors(null);
        }
        // 本体实时跟手：按增量移动（不入历史，快照已在首次移动时提交）
        useCanvasStore.getState().moveElements([...m.start.keys()], tx - m.lastDx, ty - m.lastDy);
        m.lastDx = tx;
        m.lastDy = ty;
        // PPT 式对齐参考线：按含吸附的目标落点与其他元素计算对齐线（与 snapRect 同阈值同候选）
        setAlignGuides(alignmentGuides({ x: minX + tx, y: minY + ty, width: maxX - minX, height: maxY - minY }, others));
      } else if (m.kind === "rubber") {
        m.x = wx;
        m.y = wy;
        setRubber({
          x: Math.min(m.startX, m.x),
          y: Math.min(m.startY, m.y),
          width: Math.abs(m.x - m.startX),
          height: Math.abs(m.y - m.startY),
        });
      } else if (m.kind === "draw-pen") {
        // 画笔连续采样：与上一点距离 ≥2px 才追加（平滑轨迹 + 控点数量）
        const last = m.points[m.points.length - 1];
        if (Math.hypot(wx - last.x, wy - last.y) >= 2) {
          m.points.push({ x: wx, y: wy });
          setPreview({ type: "pen", points: [...m.points] });
        }
      } else if (m.kind === "draw-shape") {
        m.x = wx;
        m.y = wy;
        const rect = {
          type: m.tool,
          x: Math.min(m.startX, m.x),
          y: Math.min(m.startY, m.y),
          width: Math.abs(m.x - m.startX),
          height: Math.abs(m.y - m.startY),
        };
        setPreview(rect);
        // 绘制中「联想」：与移动同款 PPT 式对齐参考线（预览框 vs 其他元素），
        // 迟迟不松手时也能看到对齐提示，松手成图即落规整位置
        if (rect.width >= 4 && rect.height >= 4) {
          const others = useCanvasStore.getState().doc.elements;
          setAlignGuides(alignmentGuides({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, others));
        } else {
          setAlignGuides(null);
        }
      } else if (m.kind === "chart-edit") {
        const st = useCanvasStore.getState();
        const spec = st.doc.charts?.[m.chartId];
        if (!spec) return;
        m.moved = true;
        if (m.role === "slice") {
          // 饼图接缝拖动：被拖的接缝（slice index 的起始角）精确跟手到鼠标角度，
          // 松手后 recomputeChart 重排，接缝停在鼠标松手处
          const sec = st.doc.elements.find(
            (e) => e.type === "sector" && e.bind?.chartId === m.chartId && e.bind.index === m.index
          );
          if (!sec) return;
          const angle = Math.atan2(wy - sec.y, wx - sec.x);
          st.updateChartSeamDrag(m.chartId, m.index, angle);
        } else {
          // 柱高换算：按拖动起点数值 + 指针 y 位移（绘图区高度 / y 轴上限）
          const v = m.startValue + ((m.startY - wy) / (PLOT.bottom - PLOT.top)) * m.yMax;
          st.updateChartDrag(m.chartId, m.index, Math.min(Math.max(v, 0), m.yMax));
        }
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
        // 松手：本体已实时跟手到位（拖动中逐帧 moveElements），只需清理预览状态
        setMovingIds([]);
        setMovePreview(null);
        setAlignGuides(null);
        setArrowMoveAnchors(null);
        setAnchorHint(null);
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
      } else if (m.kind === "chart-edit") {
        // 松手：拖动过才整图重排（入栈拖动前快照 = 一步撤销），未移动的点按不产生历史
        if (m.moved) useCanvasStore.getState().recomputeChart(m.chartId, m.baseline);
      } else if (m.kind === "draw-shape") {
        const w = Math.abs(m.x - m.startX);
        const h = Math.abs(m.y - m.startY);
        const st = useCanvasStore.getState();
        if (m.tool === "text") {
          // 新版文本框：单击（未拖出足够大）创建默认尺寸文本框、拖拽按框尺寸创建——
          // 创建后立即进入编辑（黑色光标可直接写字），提交保留框尺寸不按内容重算宽高
          const tw = w >= 4 ? w : 160;
          const th = h >= 4 ? h : 40;
          const el = makeElement("text", Math.min(m.startX, m.x), Math.min(m.startY, m.y), tw, th, { text: "" });
          el.width = tw;
          el.height = th;
          st.addElement(el);
          st.setSelection([el.id]);
          st.setEditingText(el.id);
        } else if (w >= 4 && h >= 4) {
          const el = makeElement(m.tool, Math.min(m.startX, m.x), Math.min(m.startY, m.y), w, h);
          st.addElement(el);
          st.setSelection([el.id]);
        }
        setPreview(null);
        setAlignGuides(null);
      } else if (m.kind === "draw-pen") {
        // 松手：创建画笔笔迹 → $1 识别命中箭头则替换为规整箭头（同方向/大小/粗细），
        // 一步撤销复原手写；未命中保留自由手绘
        const st = useCanvasStore.getState();
        const pts = m.points;
        if (pts.length >= 2) {
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          const pen = makeElement("pen", minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1), {
            points: pts,
            strokeWidth: 3,
            stroke: "#2f2f2f",
          });
          st.addElement(pen);
          const arrow = recognizeArrow(pts);
          if (arrow) {
            // 替换为规整箭头：保留手写笔迹在历史中（一步撤销回到手写）
            const el = makeElement("arrow", arrow.x, arrow.y, arrow.width, arrow.height, {
              strokeWidth: arrow.strokeWidth,
              stroke: "#2f2f2f",
            });
            st.replaceElement(pen.id, el);
          }
          st.setSelection([pen.id]);
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
        if (s.tool === "pen") {
          // 画笔：进入自由手绘模式，连续采样点列；松手创建 pen 元素并 $1 识别箭头
          modeRef.current = { kind: "draw-pen", points: [{ x: wx, y: wy }] };
          setPreview({ type: "pen", points: [{ x: wx, y: wy }] });
          startDrag();
          return;
        }
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
          // C 图表联动：命中关键节点（饼图接缝 / 柱顶）进入 chart-edit——拖比例改数据；
          // 拖图表本体（非接缝处）= 整体移动（默认拖动整图，悬浮接缝才改比例）
          const b = el.bind;
          if (b && (b.role === "slice" || b.role === "bar") && s.doc.charts?.[b.chartId]) {
            if (isChartSeam(el, wx, wy)) {
              const spec = s.doc.charts![b.chartId];
              const isSlice = b.role === "slice" && el.type === "sector";
              const cx = isSlice ? el.x : 0;
              const cy = isSlice ? el.y : 0;
              modeRef.current = {
                kind: "chart-edit",
                chartId: b.chartId,
                role: b.role,
                index: b.index ?? 0,
                startY: wy,
                startValue: spec.data[b.index ?? 0]?.value ?? 0,
                startSweep: isSlice ? el.endAngle - el.startAngle : 0,
                lastAngle: isSlice ? Math.atan2(wy - cy, wx - cx) : 0,
                sweep: 0,
                moved: false,
                yMax: b.role === "bar" ? niceScale(Math.max(...spec.data.map((d) => d.value), 1)).max : 0,
                baseline: s.doc,
              };
              if (!s.selection.includes(id)) s.setSelection([id]);
              startDrag();
              return;
            }
            // 非接缝：整体移动整张图表——选中该图表全部元素并进入 move 模式
            const chartIds = s.doc.elements.filter((x) => x.chartId === b.chartId).map((x) => x.id);
            if (!s.selection.includes(id)) s.setSelection(chartIds);
            const start = new Map<string, { x: number; y: number }>();
            for (const eid of chartIds) {
              const ee = s.doc.elements.find((x) => x.id === eid);
              if (ee) start.set(eid, { x: ee.x, y: ee.y });
            }
            modeRef.current = { kind: "move", startX: wx, startY: wy, start, moved: false, lastDx: 0, lastDy: 0 };
            startDrag();
            return;
          }
          // Shift 只追加（点击已选元素保持选区）：toggle 移除会让"点已选元素拖动"变成该元素
          // 原地不动、其他元素在动（用户报的"拖动乱动"）。取消选择走空白点击清空。
          // 组合对象：单击组内任一元素 → 整个组合被选中（整体移动/编辑）；Shift 追加同样按组展开
          const groupOf = (eid: string) => s.doc.elements.find((x) => x.id === eid)?.groupId;
          const expand = (eid: string) => {
            const g = groupOf(eid);
            if (g) return s.doc.elements.filter((x) => x.groupId === g).map((x) => x.id);
            return [eid];
          };
          const next = s.selection.includes(id)
            ? s.selection
            : e.shiftKey
              ? [...new Set([...s.selection, ...expand(id)])]
              : expand(id);
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
      const wx = worldX(e.clientX);
      const wy = worldY(e.clientY);
      // 接缝悬停：select 工具下指针落在图表关键节点（饼图接缝/柱顶）→ 光标提示可拖比例
      if (s.tool === "select") {
        const top = [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex).find((el) => hitTestElement(el, { x: wx, y: wy }));
        setSeamHover(!!top && !!top.bind && (top.bind.role === "slice" || top.bind.role === "bar") && isChartSeam(top, wx, wy));
      }
      setAnchorHint(s.tool === "arrow" || s.tool === "line" ? nearestAnchor(s.doc.elements, { x: wx, y: wy }) : null);
    },
    [worldX, worldY]
  );

  const onPointerUp = useCallback(() => {}, []);

  return { rubber, preview, panning, anchorHint, movingIds, movePreview, alignGuides, arrowMoveAnchors, seamHover, onPointerDown, onPointerMove, onPointerUp, modeRef, startTouchArrow, lastRightClickRef };
}
