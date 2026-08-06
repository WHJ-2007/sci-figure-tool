"use client";

import { useState, type ReactNode } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { alignOffsets, distributeOffsets } from "@/lib/canvas/geometry";
import type { CanvasElement, ElementType } from "@/lib/canvas/types";
import ChartDialog from "./ChartDialog";

// 科研调色板（与 prompt 审美规范一致）：同图 ≤3 色
const PALETTE = ["#eef4ff", "#f0fff0", "#fff8e6", "#f3efff", "#ffeef0", "#ffffff"];

const TYPE_NAMES: Record<ElementType | "rounded", string> = {
  rect: "矩形", rounded: "圆角矩形", ellipse: "椭圆", triangle: "三角形", diamond: "菱形",
  hexagon: "六边形", arrow: "箭头", polyline: "折线", text: "文字", logic: "逻辑节点",
  curve: "曲线", sector: "扇形", image: "图片",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/60 bg-white/55 p-3 shadow-sm backdrop-blur-md">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SliderRow({
  label, ariaLabel, value, min, max, step, onChange,
}: {
  label: string; ariaLabel: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-500">
      <span className="w-8 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={ariaLabel} onChange={(e) => onChange(Number(e.target.value))} className="h-4 flex-1 accent-blue-500" />
      <input type="number" min={min} max={max} step={step} value={value} aria-label={`${ariaLabel} 数值`} onChange={(e) => { if (e.target.value === "") return; const v = Number(e.target.value); if (Number.isNaN(v)) return; onChange(Math.min(max, Math.max(min, v))); }} className="h-6 w-12 rounded-md border border-white/70 bg-white/70 px-1 text-right text-xs text-gray-700 outline-none focus:border-blue-300" />
    </label>
  );
}

export default function PropertyPanel() {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const deleteElements = useCanvasStore((s) => s.deleteElements);
  const setSelection = useCanvasStore((s) => s.setSelection);

  // 钩子必须先于任何早退调用：空选区的早退返回不能改变钩子数量
  const [chartOpen, setChartOpen] = useState(false);

  const selected = selection.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is CanvasElement => Boolean(e));
  if (selected.length === 0) {
    return <div className="p-4 text-sm text-gray-400/90">未选中元素</div>;
  }
  const one = selected[0];
  const chartId = selected.find((e) => e.chartId)?.chartId;

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

  const isTextLike = one.type === "text" || one.type === "logic";

  return (
    <div className="space-y-3 p-3 text-sm">
      {/* 类型徽章 */}
      <header className="flex items-center gap-2">
        <span className="shrink-0 rounded-lg bg-blue-100/70 px-2 py-0.5 text-xs font-semibold text-blue-700">{TYPE_NAMES[one.type]}</span>
        {"text" in one && one.text && <span className="truncate text-xs text-gray-500">{one.text}</span>}
      </header>

      {/* 背景图案：外观——填充/边框/旋转等（对任意元素都有意义） */}
      <Section title="背景图案">
        <div className="flex items-center gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              title={`预设色 ${c}`}
              aria-label={`预设色 ${c}`}
              onClick={() => patch({ fill: c })}
              className={`lift h-6 w-6 rounded-full border ${one.fill.toLowerCase() === c ? "border-blue-500 ring-2 ring-blue-300" : "border-black/10"}`}
              style={{ background: c }}
            />
          ))}
          <label className="ml-1 flex items-center gap-1 text-xs text-gray-500">
            自定义
            <input type="color" aria-label="填充色" value={one.fill} onChange={(e) => patch({ fill: e.target.value })} className="h-6 w-8 cursor-pointer rounded-md border border-white/70 bg-white/70 p-0.5" />
          </label>
        </div>
        <SliderRow label="线宽" ariaLabel="线宽" value={one.strokeWidth} min={0} max={20} step={1} onChange={(v) => patch({ strokeWidth: v })} />
        <SliderRow label="透明度" ariaLabel="透明度" value={one.opacity} min={0} max={1} step={0.05} onChange={(v) => patch({ opacity: v })} />
        {(one.type === "rect" || one.type === "logic") && (
          <SliderRow label="圆角" ariaLabel="圆角" value={one.rx} min={0} max={50} step={1} onChange={(v) => patch({ rx: v })} />
        )}
        {one.type !== "curve" && one.type !== "sector" && (
          <SliderRow label="旋转" ariaLabel="旋转" value={one.rotation} min={-360} max={360} step={1} onChange={(v) => patch({ rotation: v })} />
        )}
        {one.type === "curve" && (
          <SliderRow label="弯曲" ariaLabel="弯曲度" value={one.curvature} min={-2} max={2} step={0.1} onChange={(v) => patch({ curvature: v } as Partial<CanvasElement>)} />
        )}
        {one.type === "sector" && (
          <div className="space-y-1 text-xs text-gray-500/90">
            <div>圆心 ({Math.round(one.x)}, {Math.round(one.y)})　半径 {Math.round(one.radius)}</div>
            <div>角度 {Math.round((one.startAngle * 180) / Math.PI)}° → {Math.round((one.endAngle * 180) / Math.PI)}°</div>
          </div>
        )}
      </Section>

      {/* 标题：逻辑节点标题或文字内容 + 字号样式 */}
      {isTextLike && (
        <Section title="标题">
          <label className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs text-gray-500">{one.type === "logic" ? "标题" : "内容"}</span>
            <input aria-label={one.type === "logic" ? "标题" : "文字内容"} value={one.text} onChange={(e) => patch({ text: e.target.value })} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/70 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
          </label>
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs text-gray-500">字号</span>
            <input type="number" aria-label="字号" value={one.fontSize} min={6} max={120} onChange={(e) => patch({ fontSize: Number(e.target.value) })} className="h-7 w-16 rounded-lg border border-white/60 bg-white/70 px-1.5 text-gray-700 shadow-sm outline-none focus:border-blue-300" />
            <button onClick={() => patch({ bold: !one.bold })} className={`lift rounded-lg border px-2 py-0.5 ${one.bold ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}>B</button>
            {one.type === "text" && (
              <button onClick={() => patch({ italic: !one.italic })} className={`lift rounded-lg border px-2 py-0.5 italic ${one.italic ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}>I</button>
            )}
          </div>
          {one.type === "text" && (
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs text-gray-500">对齐</span>
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} onClick={() => patch({ align: a })} className={`lift rounded-lg border px-2 py-0.5 ${one.align === a ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}>{a}</button>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 正文：逻辑节点多行正文 */}
      {one.type === "logic" && (
        <Section title="正文">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">正文（每行一句，回车分行）</span>
            <textarea aria-label="正文" value={one.body ?? ""} onChange={(e) => patch({ body: e.target.value })} rows={4} className="w-full rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs leading-relaxed text-gray-700 shadow-sm outline-none focus:border-blue-300" placeholder="正文内容，回车换行" />
          </label>
        </Section>
      )}

      {multi && (
        <Section title="排列">
          <div className="flex flex-wrap gap-1">
            {([["left", "左"], ["centerX", "水平居中"], ["right", "右"], ["top", "上"], ["centerY", "垂直居中"], ["bottom", "下"]] as const).map(([a, label]) => (
              <button key={a} title={label} onClick={() => applyAlign(a)} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">{label}</button>
            ))}
            <button onClick={() => applyDistribute("horizontal")} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">横分布</button>
            <button onClick={() => applyDistribute("vertical")} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">纵分布</button>
          </div>
        </Section>
      )}

      {chartId && doc.charts?.[chartId] && (
        <Section title="数据">
          <div className="flex gap-2">
            <button onClick={() => setChartOpen(true)} className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white">编辑图表数据</button>
            {/* 选中图表的单个元素后，可一键选中整个图表（统一移动/删除等操作） */}
            {!multi && (
              <button
                onClick={() => setSelection(doc.elements.filter((e) => e.chartId === chartId).map((e) => e.id))}
                className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-white/90"
              >
                选择整个图表
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title="操作">
        <div className="flex gap-2">
          <button
            onClick={() => patch({ flipH: !one.flipH })}
            title="水平镜像"
            className={`lift rounded-lg border px-2 py-1 text-xs ${one.flipH ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}
          >
            ↔ 水平镜像
          </button>
          <button
            onClick={() => patch({ flipV: !one.flipV })}
            title="垂直镜像"
            className={`lift rounded-lg border px-2 py-1 text-xs ${one.flipV ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}
          >
            ↕ 垂直镜像
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => deleteElements(selection)} className="lift rounded-lg border border-red-200/70 bg-red-50/70 px-3 py-1 text-red-500 shadow-sm hover:bg-red-100/80">删除</button>
          <button onClick={() => setSelection([])} className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1 text-gray-600 shadow-sm hover:bg-white/90">取消选择</button>
        </div>
      </Section>

      <ChartDialog open={chartOpen} chartId={chartId} initial={chartId ? doc.charts?.[chartId] ?? null : null} onClose={() => setChartOpen(false)} />
    </div>
  );
}
