"use client";

import { useCanvasStore } from "@/lib/canvas/store";
import { copySelection } from "@/lib/canvas/clipboard";

// 元素右键菜单状态：命中折点 → 删除折点；命中线段 → 新建平滑/尖锐折点；
// 命中任意元素 → 删除元素；命中图表元素 → 编辑图表数据 / 删除图表
export type ArrowMenuState =
  | { kind: "midpoint"; x: number; y: number; midIndex: number }
  | { kind: "segment"; x: number; y: number; insertAt: number; point: { x: number; y: number } }
  | { kind: "element"; x: number; y: number }
  | { kind: "chart"; chartId: string; x: number; y: number }
  | null;

export default function ArrowContextMenu({
  menu,
  onClose,
  onEditChart,
}: {
  menu: Exclude<ArrowMenuState, null>;
  onClose: () => void;
  onEditChart?: (chartId: string) => void;
}) {
  const updateElement = useCanvasStore((s) => s.updateElement);

  // 右键落在菜单内（stopPropagation 已挡 pointerdown）不应触发画布手势
  const act = (fn: () => void) => {
    fn();
    onClose();
  };

  // 删除当前选中的元素（删除后 store 自动清空选区）
  const deleteSelected = () =>
    act(() => {
      useCanvasStore.getState().deleteElements(useCanvasStore.getState().selection);
    });

  return (
    <div
      data-testid="arrow-context-menu"
      className="fixed z-50 w-44 rounded-xl border border-white/50 bg-white/85 p-1 shadow-xl backdrop-blur-xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.kind === "chart" ? (
        <>
          <button
            data-testid="edit-chart"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-blue-600"
            onClick={() => {
              onEditChart?.(menu.chartId);
              onClose();
            }}
          >
            编辑图表数据
          </button>
          <button
            data-testid="copy-element"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-gray-700"
            onClick={() => act(copySelection)}
          >
            复制
          </button>
          <div className="my-1 border-t border-white/60" />
          <button
            data-testid="delete-element"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-red-500"
            onClick={deleteSelected}
          >
            删除图表
          </button>
        </>
      ) : menu.kind === "element" ? (
        <>
          <button
            data-testid="copy-element"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-gray-700"
            onClick={() => act(copySelection)}
          >
            复制
          </button>
          <div className="my-1 border-t border-white/60" />
          <button
            data-testid="delete-element"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-red-500"
            onClick={deleteSelected}
          >
            删除元素
          </button>
        </>
      ) : menu.kind === "segment" ? (
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
        <>
          {/* 切换折点类型：当前尖锐 → 可切为平滑；当前平滑 → 可切回尖锐（任一折点均可切换） */}
          {(() => {
            const s = useCanvasStore.getState();
            const sel = s.selection.length === 1 ? s.doc.elements.find((x) => x.id === s.selection[0]) : null;
            const cur = sel?.type === "arrow" ? sel.midPoints?.[menu.midIndex] : null;
            const isSmooth = !!cur?.smooth;
            return (
              <button
                data-testid="toggle-midpoint-smooth"
                className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-gray-700"
                onClick={() =>
                  act(() => {
                    const st = useCanvasStore.getState();
                    if (st.selection.length !== 1) return;
                    const target = st.doc.elements.find((x) => x.id === st.selection[0]);
                    if (target?.type !== "arrow") return;
                    const mid = target.midPoints ?? [];
                    if (menu.midIndex >= mid.length) return;
                    // 平滑 ↔ 尖锐：平滑折点写 smooth:true，尖锐折点缺省（不带 smooth）
                    const next = mid.map((m, j) =>
                      j === menu.midIndex ? (isSmooth ? { x: m.x, y: m.y } : { ...m, smooth: true }) : m
                    );
                    st.updateElement(target.id, { midPoints: next });
                  })
                }
              >
                {isSmooth ? "切换为尖锐折点" : "切换为平滑折点"}
              </button>
            );
          })()}
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
        </>
      )}
      {menu.kind !== "element" && (
        <>
          <div className="my-1 border-t border-white/60" />
          <button
            data-testid="delete-element"
            className="lift block w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-red-500"
            onClick={deleteSelected}
          >
            删除元素
          </button>
        </>
      )}
    </div>
  );
}
