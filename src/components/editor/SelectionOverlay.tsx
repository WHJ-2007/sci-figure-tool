import { Fragment, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { logicAnchors, nearestAnchor, elementBounds, snapResizeRect, alignmentGuides, type Anchor, type AlignGuides } from "@/lib/canvas/geometry";
import type { CanvasElement } from "@/lib/canvas/types";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const HANDLE_POS: Record<(typeof HANDLES)[number], { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

// 指针 client 坐标 → 画布世界坐标（与手势模块同一换算）
function worldOf(svg: Element, c: number, axis: "x" | "y"): number {
  const r = svg.getBoundingClientRect();
  const v = useCanvasStore.getState();
  return ((c - (axis === "x" ? r.left : r.top)) - (axis === "x" ? v.view.ox : v.view.oy)) / v.view.scale;
}

function addWindowListeners(onMove: (me: PointerEvent) => void, onUp?: () => void) {
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp?.();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export default function SelectionOverlay({
  scale,
  startTouchArrow,
}: {
  scale: number;
  startTouchArrow?: (a: Anchor) => void;
}) {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  // 缩放预览框：拖动缩放手柄时显示目标尺寸（本体不实时放大，松手才应用）
  const [resizePreview, setResizePreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // 缩放对齐参考线：拖动缩放手柄时与移动相同的 PPT 式对齐线（橙色贯穿线）
  const [resizeGuides, setResizeGuides] = useState<AlignGuides | null>(null);
  // 箭头端点缩放时显示全部逻辑锚点，并高亮当前将要吸附的锚点。
  const [arrowResizeAnchor, setArrowResizeAnchor] = useState<{ active: Anchor | null } | null>(null);
  if (selection.length === 0) return null;
  const H = 8 / scale;
  const sel = selection.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is CanvasElement => Boolean(e));
  // 多选：合并包围盒（所有选中元素的真实包围盒并集），旋转手柄画在包围盒中心上方（同单选样式）
  const multi = sel.length > 1;
  const merged = (() => {
    if (!multi) return null;
    const bs = sel.map((e) => elementBounds(e));
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.width));
    const maxY = Math.max(...bs.map((b) => b.y + b.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  })();

  // 图表整体选中：任一选中元素属于图表（chartId 或 bind）→ 计算整图全部元素的合并包围盒，
  // 在最外侧画大框 + 8 向缩放手柄，可整体缩放整个图表（scaleChart 写回 spec，编辑数据不还原）
  const chartId = sel.map((e) => e.chartId || e.bind?.chartId).find(Boolean) as string | undefined;
  const chartBox = (() => {
    if (!chartId) return null;
    const members = doc.elements.filter((e) => e.chartId === chartId || e.bind?.chartId === chartId);
    if (!members.length) return null;
    const bs = members.map((e) => elementBounds(e));
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.width));
    const maxY = Math.max(...bs.map((b) => b.y + b.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  })();

  return (
    <>
      {/* 缩放预览框：蓝色虚线框提示"松手后的落点"（与移动预览同风格，本体保持原位不动） */}
      {resizePreview && (
        <g pointerEvents="none">
          <rect
            data-testid="resize-preview"
            x={resizePreview.x}
            y={resizePreview.y}
            width={resizePreview.width}
            height={resizePreview.height}
            fill="#2563eb"
            fillOpacity={0.08}
            stroke="#2563eb"
            strokeWidth={1.5 / scale}
            strokeDasharray={6 / scale}
          />
        </g>
      )}
      {/* 缩放对齐参考线：与移动同款 PPT 式橙色贯穿线（基于吸附后的目标矩形） */}
      {resizeGuides && (
        <g pointerEvents="none" data-testid="resize-guides">
          {resizeGuides.x !== undefined && (
            <line x1={resizeGuides.x} y1={0} x2={resizeGuides.x} y2={1000} stroke="#f59e0b" strokeWidth={1.5 / scale} strokeDasharray={5 / scale} />
          )}
          {resizeGuides.y !== undefined && (
            <line x1={0} y1={resizeGuides.y} x2={1600} y2={resizeGuides.y} stroke="#f59e0b" strokeWidth={1.5 / scale} strokeDasharray={5 / scale} />
          )}
        </g>
      )}
      {arrowResizeAnchor && (
        <g pointerEvents="none" data-testid="arrow-resize-anchors">
          {doc.elements.flatMap((element) => logicAnchors(element)).map((anchor) => {
            const active = arrowResizeAnchor.active?.id === anchor.id;
            return (
              <circle
                key={anchor.id}
                data-arrow-resize-anchor={anchor.side}
                data-element-id={anchor.elementId}
                data-active={active ? "true" : undefined}
                cx={anchor.x}
                cy={anchor.y}
                r={(active ? 5 : 4) / scale}
                fill={active ? "#2563eb" : "#ffffff"}
                fillOpacity={active ? 1 : 0.92}
                stroke="#2563eb"
                strokeWidth={1.5 / scale}
              />
            );
          })}
        </g>
      )}
      {sel.map((e) => {
        const b = elementBounds(e);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        // 选中框必须随元素旋转（与 ElementShape 的 rotate 一致），否则旋转后虚线框与元素脱离
        const rot = e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined;
        // 组合对象成员：独特选中提示（琥珀色虚线框 + "组" 角标），与普通蓝色选中区分
        const grouped = !!e.groupId;
        const selColor = grouped ? "#d97706" : "#2563eb";
        // 锚点已是旋转后的世界坐标，必须渲染在旋转组之外，否则会二次旋转
        const anchors = logicAnchors(e);
        return (
          <Fragment key={e.id}>
          <g pointerEvents="none" transform={rot}>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              fill="none"
              stroke={selColor}
              strokeWidth={1.5 / scale}
              strokeDasharray={6 / scale}
              rx={e.type === "rect" ? e.rx : 0}
            />
            {grouped && (
              <rect x={b.x} y={b.y - 14 / scale} width={16 / scale} height={12 / scale} rx={2 / scale} fill="#d97706" />
            )}
            {grouped && (
              <text x={b.x + 8 / scale} y={b.y - 8 / scale} textAnchor="middle" dominantBaseline="middle" fontSize={9 / scale} fill="#ffffff">组</text>
            )}
            {e.type !== "curve" && e.type !== "sector" && (
              <>
                {e.type === "arrow" ? (
                  // 箭头是端点式逻辑（不是图案式缩放）：起点/终点两个可拖动端点，
                  // 允许拖到另一端产生负宽高（翻转箭头）；无 8 向缩放/旋转手柄
                  <>
                    {(["start", "end"] as const).map((h) => {
                      const p = h === "start" ? { x: e.x, y: e.y } : { x: e.x + e.width, y: e.y + e.height };
                      return (
                        <circle
                          key={h}
                          data-handle={h}
                          data-element-id={e.id}
                          cx={p.x}
                          cy={p.y}
                          r={5 / scale}
                          fill="#2563eb"
                          stroke="#ffffff"
                          strokeWidth={1.5 / scale}
                          style={{ cursor: "move", pointerEvents: "all" }}
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            if (h === "start") startDown(ev, e, setArrowResizeAnchor);
                            else endDown(ev, e, setArrowResizeAnchor);
                          }}
                        />
                      );
                    })}
                  </>
                ) : (
                  <>
                    {HANDLES.map((h) => {
                      const p = HANDLE_POS[h];
                      // 手柄中心外移 H（8/scale）到包围盒之外：点元素本体（含边缘）只触发拖动；
                      // 否则手柄压在元素边上，AI 生成的小元素（40x30）边缘全被手柄覆盖，拖动会误触缩放/旋转（"乱飞"）
                      const hx = b.x + p.x * b.width + (p.x - 0.5) * 2 * H;
                      const hy = b.y + p.y * b.height + (p.y - 0.5) * 2 * H;
                      return (
                        <rect
                          key={h}
                          data-handle={h}
                          data-element-id={e.id}
                          x={hx - H / 2}
                          y={hy - H / 2}
                          width={H}
                          height={H}
                          fill="#ffffff"
                          stroke="#2563eb"
                          strokeWidth={1.5 / scale}
                          style={{ cursor: "nwse-resize", pointerEvents: "all" }}
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            handleDown(ev, e, h, setResizePreview, setResizeGuides);
                          }}
                        />
                      );
                    })}
                    <rect
                      data-handle="rotate"
                      data-element-id={e.id}
                      x={cx - H / 2}
                      y={b.y - H - 14 / scale}
                      width={H}
                      height={H}
                      rx={H / 2}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth={1.5 / scale}
                      style={{ cursor: "grab", pointerEvents: "all" }}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        rotateDown(ev, e);
                      }}
                    />
                  </>
                )}
              </>
            )}
            {/* 箭头折点手柄：平滑折点=圆点、尖锐折点=方点；折点为相对坐标，渲染时偏移起点；
                可单独拖动改变折点位置；右键折点删除（右键线段插入由 Canvas 的 contextmenu 处理） */}
            {e.type === "arrow" &&
              (e.midPoints ?? []).map((mp, i) =>
                mp.smooth ? (
                  <circle
                    key={`mid-${i}`}
                    data-midpoint={i}
                    data-element-id={e.id}
                    cx={e.x + mp.x}
                    cy={e.y + mp.y}
                    r={H / 2}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1.5 / scale}
                    style={{ cursor: "crosshair", pointerEvents: "all" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      midDown(ev, e, i);
                    }}
                  />
                ) : (
                  <rect
                    key={`mid-${i}`}
                    data-midpoint={i}
                    data-element-id={e.id}
                    x={e.x + mp.x - H / 2}
                    y={e.y + mp.y - H / 2}
                    width={H}
                    height={H}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={1.5 / scale}
                    style={{ cursor: "crosshair", pointerEvents: "all" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      midDown(ev, e, i);
                    }}
                  />
                )
              )}
          </g>
          {anchors.length > 0 && (
            <g>
              {anchors.map((a) => (
                <circle
                  key={a.id}
                  data-anchor={a.side}
                  data-element-id={a.elementId}
                  cx={a.x}
                  cy={a.y}
                  r={5 / scale}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={1.5 / scale}
                  style={{ cursor: "crosshair", pointerEvents: "all" }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    startTouchArrow?.(a);
                  }}
                />
              ))}
            </g>
          )}
          </Fragment>
        );
      })}
      {/* 多选旋转手柄：画在合并包围盒中心上方（与单选旋转手柄同款圆点，明显可拖） */}
      {merged && (
        <g>
          {/* 旋转轴参考线：中心到上方手柄的短线，提示旋转中心 */}
          <line
            x1={merged.x + merged.width / 2}
            y1={merged.y + merged.height / 2}
            x2={merged.x + merged.width / 2}
            y2={merged.y - H - 14 / scale}
            stroke="#2563eb"
            strokeWidth={1 / scale}
            strokeDasharray={3 / scale}
            opacity={0.5}
            pointerEvents="none"
          />
          <rect
            data-handle="rotate-multi"
            x={merged.x + merged.width / 2 - H / 2}
            y={merged.y - H - 14 / scale - H / 2}
            width={H}
            height={H}
            rx={H / 2}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={2 / scale}
            style={{ cursor: "grab", pointerEvents: "all" }}
            onPointerDown={(ev) => {
              ev.stopPropagation();
              multiRotateDown(ev);
            }}
          />
        </g>
      )}
      {/* 图表整体框：最外侧大框 + 8 向缩放手柄，绕图表包围盒中心整体缩放（scaleChart 写回 spec） */}
      {chartBox && (
        <g pointerEvents="none">
          <rect
            data-testid="chart-overlay-box"
            x={chartBox.x}
            y={chartBox.y}
            width={chartBox.width}
            height={chartBox.height}
            fill="none"
            stroke="#7c3aed"
            strokeWidth={2 / scale}
            strokeDasharray={8 / scale}
            rx={6 / scale}
          />
          <text x={chartBox.x} y={chartBox.y - 6 / scale} textAnchor="start" fontSize={11 / scale} fill="#7c3aed" fontWeight="bold">
            图表
          </text>
          {HANDLES.map((h) => {
            const p = HANDLE_POS[h];
            const hx = chartBox.x + p.x * chartBox.width;
            const hy = chartBox.y + p.y * chartBox.height;
            return (
              <rect
                key={h}
                data-chart-handle={h}
                x={hx - H / 2}
                y={hy - H / 2}
                width={H}
                height={H}
                rx={2 / scale}
                fill="#ffffff"
                stroke="#7c3aed"
                strokeWidth={2 / scale}
                style={{ cursor: "nwse-resize", pointerEvents: "all" }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  chartScaleDown(ev, chartId!, chartBox, h, setResizePreview);
                }}
              />
            );
          })}
        </g>
      )}
    </>
  );
}

// 图表整体缩放：以图表包围盒中心为锚点等比缩放（拖动任意手柄 → 计算比例 → scaleChart 整图重排）
function chartScaleDown(
  ev: React.PointerEvent,
  chartId: string,
  box: { x: number; y: number; width: number; height: number },
  handle: (typeof HANDLES)[number],
  setPreview: (r: { x: number; y: number; width: number; height: number } | null) => void
) {
  const s = useCanvasStore.getState();
  s.commitHistory(); // 缩放前提交快照，一次缩放 = 一步撤销
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const svg = (ev.target as Element).closest("svg")!;
  let factor = 1;
  const onMove = (me: PointerEvent) => {
    const wx = worldOf(svg, me.clientX, "x");
    const wy = worldOf(svg, me.clientY, "y");
    // 角点：取横纵比例较大者（等比缩放）；边中点：只按对应轴比例
    const fx = Math.abs(wx - cx) / hw;
    const fy = Math.abs(wy - cy) / hh;
    factor = Math.max(
      0.2,
      handle === "n" || handle === "s" ? fy :
      handle === "e" || handle === "w" ? fx :
      Math.max(fx, fy)
    );
    const nw = hw * 2 * factor;
    const nh = hh * 2 * factor;
    setPreview({ x: cx - nw / 2, y: cy - nh / 2, width: nw, height: nh });
  };
  const onUp = () => {
    setPreview(null);
    useCanvasStore.getState().scaleChart(chartId, factor);
  };
  addWindowListeners(onMove, onUp);
}

function handleDown(
  ev: React.PointerEvent,
  e: CanvasElement,
  handle: (typeof HANDLES)[number],
  setResizePreview: (r: { x: number; y: number; width: number; height: number } | null) => void,
  setResizeGuides: (g: AlignGuides | null) => void
) {
  const s = useCanvasStore.getState();
  // AI 非阻塞：AI 正在编辑的元素锁定——缩放手柄不可拖动
  if (s.aiLockedIds.includes(e.id)) return;
  s.commitHistory(); // 缩放前提交快照（手势前状态），一次缩放 = 一步撤销
  const rect = { x: e.x, y: e.y, width: e.width, height: e.height };
  const svg = (ev.target as Element).closest("svg")!;
  const others = useCanvasStore.getState().doc.elements.filter((x) => x.id !== e.id);
  let last: { x: number; y: number; width: number; height: number } = rect;
  const onMove = (me: PointerEvent) => {
    const wx = worldOf(svg, me.clientX, "x");
    const wy = worldOf(svg, me.clientY, "y");
    let { x, y, width, height } = rect;
    if (handle.includes("e")) width = wx - x;
    if (handle.includes("w")) { width = x + width - wx; x = wx; }
    if (handle.includes("s")) height = wy - y;
    if (handle.includes("n")) { height = y + height - wy; y = wy; }
    // 缩放吸附：只吸附被拖动的边，避免整框漂移（与移动吸附同阈值）
    last = snapResizeRect({ x, y, width: Math.max(8, width), height: Math.max(8, height) }, handle, others);
    // 预览框：本体不实时放大（避免误导尺寸判断），只显示目标落点，松手才应用
    setResizePreview(last);
    // 缩放对齐参考线：与移动同款 PPT 式橙色贯穿线（基于吸附后的目标矩形）。
    // 只显示被拖动边对应的轴（e/w → 竖线，s/n → 横线，角点两轴都显示），
    // 避免另一轴的候选线出现在与缩放无关的位置造成"错乱"
    const guides = alignmentGuides(last, others);
    const showX = handle.includes("e") || handle.includes("w");
    const showY = handle.includes("s") || handle.includes("n");
    setResizeGuides({
      ...(showX ? { x: guides.x } : {}),
      ...(showY ? { y: guides.y } : {}),
    });
  };
  const onUp = () => {
    setResizePreview(null);
    setResizeGuides(null);
    useCanvasStore.getState().updateElementFast(e.id, last);
  };
  addWindowListeners(onMove, onUp);
}

// 拖动箭头起点：终点固定，起点跟随指针；折点保持世界位置不变（相对坐标随新起点重算）
function startDown(
  ev: React.PointerEvent,
  e: CanvasElement,
  setAnchorState: (state: { active: Anchor | null } | null) => void
) {
  // 仅箭头有起点手柄（调用点已按 arrow 渲染该手柄）
  if (e.type !== "arrow") return;
  const s = useCanvasStore.getState();
  if (s.aiLockedIds.includes(e.id)) return;
  s.commitHistory(); // 拖动前提交快照，一次拖动 = 一步撤销
  const x2 = e.x + e.width;
  const y2 = e.y + e.height;
  const svg = (ev.target as Element).closest("svg")!;
  // 折点原世界位置（相对坐标 + 旧起点）；拖动起点时世界位置不变 → 相对坐标随新起点重算
  const mids = (e.midPoints ?? []).map((m) => ({ ...m, x: e.x + m.x, y: e.y + m.y }));
  setAnchorState({ active: null });
  const onMove = (me: PointerEvent) => {
    const state = useCanvasStore.getState();
    const pointer = { x: worldOf(svg, me.clientX, "x"), y: worldOf(svg, me.clientY, "y") };
    const anchor = nearestAnchor(state.doc.elements, pointer);
    const x = anchor?.x ?? pointer.x;
    const y = anchor?.y ?? pointer.y;
    setAnchorState({ active: anchor });
    state.updateElementFast(e.id, {
      x,
      y,
      width: x2 - x,
      height: y2 - y,
      startId: anchor?.elementId,
      midPoints: mids.map((m) => (m.smooth ? { x: m.x - x, y: m.y - y, smooth: true } : { x: m.x - x, y: m.y - y })),
    });
  };
  addWindowListeners(onMove, () => setAnchorState(null));
}

// 拖动箭头终点：起点固定，终点跟随指针（折点为相对坐标，无需改动）
function endDown(
  ev: React.PointerEvent,
  e: CanvasElement,
  setAnchorState: (state: { active: Anchor | null } | null) => void
) {
  const s = useCanvasStore.getState();
  if (s.aiLockedIds.includes(e.id)) return;
  s.commitHistory(); // 拖动前提交快照，一次拖动 = 一步撤销
  const svg = (ev.target as Element).closest("svg")!;
  setAnchorState({ active: null });
  const onMove = (me: PointerEvent) => {
    const state = useCanvasStore.getState();
    const pointer = { x: worldOf(svg, me.clientX, "x"), y: worldOf(svg, me.clientY, "y") };
    const anchor = nearestAnchor(state.doc.elements, pointer);
    const x = anchor?.x ?? pointer.x;
    const y = anchor?.y ?? pointer.y;
    setAnchorState({ active: anchor });
    state.updateElementFast(e.id, {
      width: x - e.x,
      height: y - e.y,
      endId: anchor?.elementId,
    });
  };
  addWindowListeners(onMove, () => setAnchorState(null));
}

// 拖动箭头中间折点：只改该折点相对箭头起点的坐标，箭头两端与其余折点不动（相对位置改变）
function midDown(ev: React.PointerEvent, e: CanvasElement, i: number) {
  // 仅箭头有折点（调用点已按 arrow 渲染该手柄）
  if (e.type !== "arrow" || !e.midPoints) return;
  const s = useCanvasStore.getState();
  // AI 非阻塞：AI 正在编辑的元素锁定——折点不可拖动
  if (s.aiLockedIds.includes(e.id)) return;
  s.commitHistory(); // 拖动前提交快照，一次拖动 = 一步撤销
  const svg = (ev.target as Element).closest("svg")!;
  const onMove = (me: PointerEvent) => {
    useCanvasStore.getState().updateElementFast(e.id, {
      midPoints: e.midPoints!.map((m, j) =>
        j === i ? { ...m, x: worldOf(svg, me.clientX, "x") - e.x, y: worldOf(svg, me.clientY, "y") - e.y } : m
      ),
    });
  };
  addWindowListeners(onMove);
}

function rotateDown(ev: React.PointerEvent, e: CanvasElement) {
  const s = useCanvasStore.getState();
  // AI 非阻塞：AI 正在编辑的元素锁定——旋转手柄不可拖动
  if (s.aiLockedIds.includes(e.id)) return;
  s.commitHistory(); // 旋转前提交快照（手势前状态），一次旋转 = 一步撤销
  // 与选中框一致用真实包围盒中心，避免负宽高元素旋转中心错位
  const b = elementBounds(e);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const svg = (ev.target as Element).closest("svg")!;
  const onMove = (me: PointerEvent) => {
    const wx = worldOf(svg, me.clientX, "x");
    const wy = worldOf(svg, me.clientY, "y");
    const deg = (Math.atan2(wy - cy, wx - cx) * 180) / Math.PI + 90;
    useCanvasStore.getState().updateElementFast(e.id, { rotation: Math.round(deg) });
  };
  addWindowListeners(onMove);
}

// 多选整体旋转：绕合并包围盒中心拖动旋转（同单选旋转手柄交互）；
// 按下提交一次快照（一步撤销），拖动逐帧 rotateSelectionFast（不入历史）
function multiRotateDown(ev: React.PointerEvent) {
  const s = useCanvasStore.getState();
  if (s.selection.length < 2) return;
  // AI 非阻塞：任一选中元素被 AI 锁定则整组不可旋转
  if (s.selection.some((id) => s.aiLockedIds.includes(id))) return;
  s.commitHistory(); // 旋转前提交快照（手势前状态），一次旋转 = 一步撤销
  // 合并包围盒中心（与旋转手柄渲染位置一致）
  const targets = s.doc.elements.filter((e) => s.selection.includes(e.id));
  if (targets.length < 2) return;
  const bs = targets.map((e) => elementBounds(e));
  const minX = Math.min(...bs.map((b) => b.x));
  const maxX = Math.max(...bs.map((b) => b.x + b.width));
  const minY = Math.min(...bs.map((b) => b.y));
  const maxY = Math.max(...bs.map((b) => b.y + b.height));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const svg = (ev.target as Element).closest("svg")!;
  let lastDeg = (Math.atan2(-cy, -cx) * 180) / Math.PI + 90;
  const onMove = (me: PointerEvent) => {
    const wx = worldOf(svg, me.clientX, "x");
    const wy = worldOf(svg, me.clientY, "y");
    const deg = (Math.atan2(wy - cy, wx - cx) * 180) / Math.PI + 90;
    // 逐帧增量旋转：rotateSelectionFast 相对当前状态旋转增量角（不入历史）
    const delta = deg - lastDeg;
    lastDeg = deg;
    if (delta !== 0) useCanvasStore.getState().rotateSelectionFast(delta);
  };
  addWindowListeners(onMove);
}
