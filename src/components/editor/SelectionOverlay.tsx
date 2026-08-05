import { useCanvasStore } from "@/lib/canvas/store";
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

// 真实包围盒：arrow 负向拖拽时 width/height 为负，polyline 创建时宽高为 0，需归一化
function boundsOf(e: CanvasElement): { x: number; y: number; width: number; height: number } {
  if (e.type === "arrow") {
    const x2 = e.x + e.width, y2 = e.y + e.height;
    return { x: Math.min(e.x, x2), y: Math.min(e.y, y2), width: Math.abs(e.width), height: Math.abs(e.height) };
  }
  if (e.type === "polyline") {
    const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

export default function SelectionOverlay({ scale }: { scale: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  if (selection.length === 0) return null;
  const H = 8 / scale;
  const sel = selection.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is CanvasElement => Boolean(e));

  return (
    <>
      {sel.map((e) => {
        const b = boundsOf(e);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        // 选中框必须随元素旋转（与 ElementShape 的 rotate 一致），否则旋转后虚线框与元素脱离
        const rot = e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined;
        return (
          <g key={e.id} pointerEvents="none" transform={rot}>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              fill="none"
              stroke="#2563eb"
              strokeWidth={1.5 / scale}
              strokeDasharray={6 / scale}
              rx={e.type === "rect" ? e.rx : 0}
            />
            {HANDLES.map((h) => {
              const p = HANDLE_POS[h];
              // 手柄中心外移 H（8/scale）到包围盒之外：点元素本体（含边缘）只触发拖动；
              // 否则手柄压在元素边上，AI 生成的小元素（40x30）边缘全被手柄覆盖，拖动会误触缩放/旋转（"乱飞"）
              const cx = b.x + p.x * b.width + (p.x - 0.5) * 2 * H;
              const cy = b.y + p.y * b.height + (p.y - 0.5) * 2 * H;
              return (
                <rect
                  key={h}
                  data-handle={h}
                  data-element-id={e.id}
                  x={cx - H / 2}
                  y={cy - H / 2}
                  width={H}
                  height={H}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={1.5 / scale}
                  style={{ cursor: "nwse-resize", pointerEvents: "all" }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    handleDown(ev, e, h, scale);
                  }}
                />
              );
            })}
            <rect
              data-handle="rotate"
              data-element-id={e.id}
              x={cx - H / 2}
              y={b.y - H - 8 / scale}
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
          </g>
        );
      })}
    </>
  );
}

function handleDown(ev: React.PointerEvent, e: CanvasElement, handle: (typeof HANDLES)[number], scale: number) {
  const s = useCanvasStore.getState();
  if (s.isGenerating) return;
  s.commitHistory(); // 缩放前提交快照（手势前状态），一次缩放 = 一步撤销
  const rect = { x: e.x, y: e.y, width: e.width, height: e.height };
  const startX = ev.clientX;
  const startY = ev.clientY;
  const svg = (ev.target as Element).closest("svg")!;
  const world = (c: number, axis: "x" | "y") => {
    const r = svg.getBoundingClientRect();
    const v = useCanvasStore.getState();
    return ((c - (axis === "x" ? r.left : r.top)) - (axis === "x" ? v.view.ox : v.view.oy)) / v.view.scale;
  };
  const onMove = (me: PointerEvent) => {
    const wx = world(me.clientX, "x");
    const wy = world(me.clientY, "y");
    let { x, y, width, height } = rect;
    if (handle.includes("e")) width = wx - x;
    if (handle.includes("w")) { width = x + width - wx; x = wx; }
    if (handle.includes("s")) height = wy - y;
    if (handle.includes("n")) { height = y + height - wy; y = wy; }
    width = Math.max(8, width);
    height = Math.max(8, height);
    // 缩放逐帧更新不入历史（onDown 时已 commitHistory 一次）
    useCanvasStore.getState().updateElementFast(e.id, { x, y, width, height });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function rotateDown(ev: React.PointerEvent, e: CanvasElement) {
  const s = useCanvasStore.getState();
  if (s.isGenerating) return;
  s.commitHistory(); // 旋转前提交快照（手势前状态），一次旋转 = 一步撤销
  // 与选中框一致用真实包围盒中心，避免负宽高元素旋转中心错位
  const b = boundsOf(e);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const onMove = (me: PointerEvent) => {
    const svg = (ev.target as Element).closest("svg")!;
    const r = svg.getBoundingClientRect();
    const v = useCanvasStore.getState();
    const wx = (me.clientX - r.left - v.view.ox) / v.view.scale;
    const wy = (me.clientY - r.top - v.view.oy) / v.view.scale;
    const deg = (Math.atan2(wy - cy, wx - cx) * 180) / Math.PI + 90;
    useCanvasStore.getState().updateElementFast(e.id, { rotation: Math.round(deg) });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
