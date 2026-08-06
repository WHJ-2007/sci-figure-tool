"use client";

import { useCanvasStore } from "@/lib/canvas/store";

// 箭头右键菜单状态：命中折点 → 删除；命中线段 → 新建平滑/尖锐折点
export type ArrowMenuState =
  | { kind: "midpoint"; x: number; y: number; midIndex: number }
  | { kind: "segment"; x: number; y: number; insertAt: number; point: { x: number; y: number } }
  | null;

export default function ArrowContextMenu({
  menu,
  onClose,
}: {
  menu: Exclude<ArrowMenuState, null>;
  onClose: () => void;
}) {
  const updateElement = useCanvasStore((s) => s.updateElement);

  // 右键落在菜单内（stopPropagation 已挡 pointerdown）不应触发画布手势
  const act = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div
      data-testid="arrow-context-menu"
      className="fixed z-50 w-40 rounded-xl border border-white/50 bg-white/85 p-1 shadow-xl backdrop-blur-md"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.kind === "segment" ? (
        <>
          <button
            data-testid="add-smooth-midpoint"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-gray-700"
            onClick={() =>
              act(() => {
                const s = useCanvasStore.getState();
                if (s.selection.length !== 1) return;
                const sel = s.doc.elements.find((x) => x.id === s.selection[0]);
                if (sel?.type !== "arrow") return;
                const mid = sel.midPoints ?? [];
                s.updateElement(sel.id, {
                  midPoints: [...mid.slice(0, menu.insertAt), { ...menu.point, smooth: true }, ...mid.slice(menu.insertAt)],
                });
              })
            }
          >
            新建平滑折点
          </button>
          <button
            data-testid="add-sharp-midpoint"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-gray-700"
            onClick={() =>
              act(() => {
                const s = useCanvasStore.getState();
                if (s.selection.length !== 1) return;
                const sel = s.doc.elements.find((x) => x.id === s.selection[0]);
                if (sel?.type !== "arrow") return;
                const mid = sel.midPoints ?? [];
                // 尖锐折点不写 smooth（缺省即尖锐），数据干净
                s.updateElement(sel.id, {
                  midPoints: [...mid.slice(0, menu.insertAt), { ...menu.point }, ...mid.slice(menu.insertAt)],
                });
              })
            }
          >
            新建尖锐折点
          </button>
        </>
      ) : (
        <button
          data-testid="delete-midpoint"
          className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-red-500"
          onClick={() =>
            act(() => {
              const s = useCanvasStore.getState();
              if (s.selection.length !== 1) return;
              const sel = s.doc.elements.find((x) => x.id === s.selection[0]);
              if (sel?.type !== "arrow") return;
              const mid = sel.midPoints ?? [];
              if (menu.midIndex < mid.length) {
                s.updateElement(sel.id, { midPoints: mid.filter((_, j) => j !== menu.midIndex) });
              }
            })
          }
        >
          删除折点
        </button>
      )}
    </div>
  );
}
