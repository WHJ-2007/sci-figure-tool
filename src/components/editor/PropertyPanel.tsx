"use client";

import { useCanvasStore } from "@/lib/canvas/store";
import { alignOffsets, distributeOffsets } from "@/lib/canvas/geometry";
import type { CanvasElement } from "@/lib/canvas/types";

export default function PropertyPanel() {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const deleteElements = useCanvasStore((s) => s.deleteElements);
  const setSelection = useCanvasStore((s) => s.setSelection);

  const selected = selection.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is CanvasElement => Boolean(e));
  if (selected.length === 0) {
    return <div className="p-4 text-sm text-gray-400/90">未选中元素</div>;
  }
  const one = selected[0];

  const patch = (p: Partial<CanvasElement>) => updateElement(one.id, p);
  const multi = selected.length > 1;

  const applyAlign = (axis: "left" | "right" | "top" | "bottom" | "centerX" | "centerY") => {
    // 偏移与循环内元素位置取自同一旧 doc 快照：对齐后参考元素位置不再用于其余元素
    const offs = alignOffsets(selection, doc.elements, axis);
    // 一次对齐 = 一步撤销：先提交快照，逐元素用 updateElementFast（不入历史）
    const s = useCanvasStore.getState();
    s.commitHistory();
    for (const [id, { dx, dy }] of offs) {
      const el = doc.elements.find((e) => e.id === id);
      if (!el) continue;
      s.updateElementFast(id, { x: el.x + dx, y: el.y + dy });
    }
  };
  const applyDistribute = (dir: "horizontal" | "vertical") => {
    // 偏移与循环内元素位置取自同一旧 doc 快照：避免前一元素位移污染后续偏移
    const offs = distributeOffsets(selection, doc.elements, dir);
    const s = useCanvasStore.getState();
    s.commitHistory();
    for (const [id, { dx, dy }] of offs) {
      const el = doc.elements.find((e) => e.id === id);
      if (!el) continue;
      s.updateElementFast(id, { x: el.x + dx, y: el.y + dy });
    }
  };

  return (
    <div className="space-y-3 p-3 text-sm">
      {multi && (
        <div>
          <div className="mb-1 font-medium">排列</div>
          <div className="flex flex-wrap gap-1">
            {([["left", "左"], ["centerX", "水平居中"], ["right", "右"], ["top", "上"], ["centerY", "垂直居中"], ["bottom", "下"]] as const).map(([a, label]) => (
              <button key={a} title={label} onClick={() => applyAlign(a)} className="lift rounded-lg border border-white/60 bg-white/60 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">{label}</button>
            ))}
            <button onClick={() => applyDistribute("horizontal")} className="lift rounded-lg border border-white/60 bg-white/60 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">横分布</button>
            <button onClick={() => applyDistribute("vertical")} className="lift rounded-lg border border-white/60 bg-white/60 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">纵分布</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2">
          <span className="text-gray-500/90">填充色</span>
          <input type="color" aria-label="填充色" value={one.fill} onChange={(e) => patch({ fill: e.target.value })} className="h-7 w-10 cursor-pointer rounded-lg border border-white/60 bg-white/60 p-0.5 shadow-sm" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-500/90">边框色</span>
          <input type="color" aria-label="边框色" value={one.stroke} onChange={(e) => patch({ stroke: e.target.value })} className="h-7 w-10 cursor-pointer rounded-lg border border-white/60 bg-white/60 p-0.5 shadow-sm" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-500/90">线宽</span>
          <input type="number" aria-label="线宽" value={one.strokeWidth} min={0} max={20} onChange={(e) => {
            if (e.target.value === "") return; // 清空输入框不触发变更，避免 Number("")=0 把描边置 0
            patch({ strokeWidth: Number(e.target.value) });
          }} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-500/90">透明度</span>
          <input type="range" aria-label="透明度" value={one.opacity} min={0} max={1} step={0.05} onChange={(e) => patch({ opacity: Number(e.target.value) })} className="w-20 accent-blue-500" />
        </label>
      </div>
      {one.type === "text" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="text-gray-500/90">文字内容</span>
            <input aria-label="文字内容" value={one.text} onChange={(e) => patch({ text: e.target.value })} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500/90">字号</span>
            <input type="number" aria-label="字号" value={one.fontSize} min={6} max={120} onChange={(e) => patch({ fontSize: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
            <button onClick={() => patch({ bold: !one.bold })} className={`lift rounded-lg border px-2 py-0.5 ${one.bold ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/60 text-gray-600 shadow-sm hover:bg-white/90"}`}>B</button>
            <button onClick={() => patch({ italic: !one.italic })} className={`lift rounded-lg border px-2 py-0.5 italic ${one.italic ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/60 text-gray-600 shadow-sm hover:bg-white/90"}`}>I</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">对齐</span>
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} onClick={() => patch({ align: a })} className={`lift rounded-lg border px-2 py-0.5 ${one.align === a ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/60 text-gray-600 shadow-sm hover:bg-white/90"}`}>{a}</button>
            ))}
          </div>
        </div>
      )}
      {one.type === "rect" && (
        <label className="flex items-center gap-2">
          <span className="text-gray-500/90">圆角</span>
          <input type="number" aria-label="圆角" value={one.rx} min={0} max={50} onChange={(e) => patch({ rx: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
        </label>
      )}
      {one.type === "logic" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="text-gray-500/90">标题</span>
            <input aria-label="标题" value={one.text} onChange={(e) => patch({ text: e.target.value })} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500/90">字号</span>
            <input type="number" aria-label="字号" value={one.fontSize} min={6} max={120} onChange={(e) => patch({ fontSize: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
            <button onClick={() => patch({ bold: !one.bold })} className={`lift rounded-lg border px-2 py-0.5 ${one.bold ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/60 text-gray-600 shadow-sm hover:bg-white/90"}`}>B</button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500/90">正文（每行一句，回车分行）</span>
            <textarea
              aria-label="正文"
              value={one.body ?? ""}
              onChange={(e) => patch({ body: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-white/60 bg-white/60 px-2 py-1.5 text-xs leading-relaxed text-gray-700 shadow-sm outline-none focus:border-blue-300"
              placeholder="正文内容，回车换行"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-500/90">圆角</span>
            <input type="number" aria-label="圆角" value={one.rx} min={0} max={50} onChange={(e) => patch({ rx: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
          </label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-gray-500/90">旋转</span>
        <input type="number" aria-label="旋转" value={one.rotation} min={-360} max={360} onChange={(e) => patch({ rotation: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/60 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => deleteElements(selection)} className="lift rounded-lg border border-red-200/70 bg-red-50/70 px-3 py-1 text-red-500 shadow-sm hover:bg-red-100/80">删除</button>
        <button onClick={() => setSelection([])} className="lift rounded-lg border border-white/60 bg-white/60 px-3 py-1 text-gray-600 shadow-sm hover:bg-white/90">取消选择</button>
      </div>
    </div>
  );
}
