import { useCanvasStore } from "@/lib/canvas/store";

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

export default function SelectionOverlay({ scale }: { scale: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  if (selection.length === 0) return null;
  const H = 8 / scale;
  const sel = selection.map((id) => doc.elements.find((e) => e.id === id)).filter(Boolean) as any[];

  return (
    <>
      {sel.map((e) => {
        const cx = e.x + e.width / 2;
        const cy = e.y + e.height / 2;
        return (
          <g key={e.id} pointerEvents="none">
            <rect
              x={e.x}
              y={e.y}
              width={e.width}
              height={e.height}
              fill="none"
              stroke="#2563eb"
              strokeWidth={1.5 / scale}
              strokeDasharray={6 / scale}
              rx={e.type === "rect" ? e.rx : 0}
            />
            {HANDLES.map((h) => {
              const p = HANDLE_POS[h];
              return (
                <rect
                  key={h}
                  data-handle={h}
                  data-element-id={e.id}
                  x={e.x + p.x * e.width - H / 2}
                  y={e.y + p.y * e.height - H / 2}
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
              y={e.y - H - 8 / scale}
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

function handleDown(ev: React.PointerEvent, e: any, handle: string, scale: number) {
  const s = useCanvasStore.getState();
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
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function rotateDown(ev: React.PointerEvent, e: any) {
  useCanvasStore.getState().commitHistory(); // 旋转前提交快照（手势前状态），一次旋转 = 一步撤销
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
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
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
