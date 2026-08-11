"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { lineBounds } from "@/lib/canvas/geometry";
import { adjustSaturation, saturationOf } from "@/lib/canvas/color";
import type { CanvasElement, ElementType, ElementShadow } from "@/lib/canvas/types";
import ChartDialog from "./ChartDialog";

// 通用色板（常用色置前 + 科研调色板 + 全谱系常用色）：行 1 常用黑白灰 + 强饱和主色、
// 行 2 中饱和、行 3 深色、行 4 科研浅色底 + 中性；点击即选、当前色蓝环高亮，自定义 hex 精确输入
const SWATCHES = [
  "#ffffff", "#111827", "#2f2f2f", "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#f87171", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa",
  "#b91c1c", "#c2410c", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#8b5cf6",
  "#eef4ff", "#f0fff0", "#fff8e6", "#f3efff", "#ffeef0", "#f8fafc", "#f97316",
];

function ColorPicker({ value, onChange, ariaLabel }: { value: string; onChange: (c: string) => void; ariaLabel: string }) {
  // 本地 hex 输入与外部值双向同步：合法 6 位 hex 即写入，非法输入失焦后回退显示当前值
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="min-w-0 flex-1">
      <div className="grid grid-cols-7 gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`预设色 ${c}`}
            onClick={() => onChange(c)}
            className={`lift aspect-square w-full rounded-md border ${value.toLowerCase() === c ? "border-blue-500 ring-2 ring-blue-300" : "border-black/10 hover:ring-2 hover:ring-blue-200"}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        <span className="shrink-0">自定义</span>
        <input
          value={hex}
          aria-label={ariaLabel}
          onChange={(e) => {
            const v = e.target.value;
            setHex(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setHex(value)}
          className="h-6 w-full min-w-0 flex-1 rounded-md border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
          placeholder="#rrggbb"
        />
      </label>
    </div>
  );
}

// 颜色选择折叠区：默认收起，点击「选择颜色 + 当前色块」展开/收回选色器（grid-rows 动画，与更新日志折叠同款）
function CollapsibleColor({ value, onChange, ariaLabel }: { value: string; onChange: (c: string) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-white/60 bg-white/50 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="lift flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/70"
      >
        <span className="text-xs text-gray-600">选择颜色</span>
        <span className="ml-auto h-4 w-6 shrink-0 rounded border border-black/10" style={{ background: value }} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="border-t border-white/50 px-2 py-2">
            <ColorPicker value={value} onChange={onChange} ariaLabel={ariaLabel} />
          </div>
        </div>
      </div>
    </div>
  );
}

const TYPE_NAMES: Record<ElementType | "rounded", string> = {
  rect: "矩形", rounded: "圆角矩形", ellipse: "椭圆", triangle: "三角形", diamond: "菱形",
  hexagon: "六边形", star: "五角星", cross: "十字", donut: "圆环", half: "半圆",
  arrow: "箭头", polyline: "折线", text: "文字", logic: "逻辑节点", formula: "公式",
  curve: "曲线", sector: "扇形", image: "图片", pen: "画笔",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/60 bg-white/55 p-3 shadow-sm backdrop-blur-xl">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// 整体阴影：未设置时显示"添加阴影"按钮（默认柔和黑色投影），设置后显示模糊/偏移/浓淡/颜色/移除
function ShadowControls({ e, patch }: { e: CanvasElement; patch: (p: Partial<CanvasElement>) => void }) {
  const sh = e.shadow;
  if (!sh) {
    return (
      <button
        onClick={() => patch({ shadow: { color: "#000000", blur: 8, dx: 2, dy: 2, opacity: 0.25 } })}
        className="lift w-full rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-xs text-gray-600 shadow-sm hover:bg-white/90"
      >
        ＋ 添加阴影
      </button>
    );
  }
  const set = (p: Partial<ElementShadow>) => patch({ shadow: { ...sh, ...p } });
  return (
    <div className="space-y-2">
      <SliderRow label="模糊" ariaLabel="阴影模糊" value={sh.blur} min={0} max={30} step={1} onChange={(v) => set({ blur: v })} />
      <SliderRow label="水平" ariaLabel="阴影水平偏移" value={sh.dx} min={-30} max={30} step={1} onChange={(v) => set({ dx: v })} />
      <SliderRow label="垂直" ariaLabel="阴影垂直偏移" value={sh.dy} min={-30} max={30} step={1} onChange={(v) => set({ dy: v })} />
      <SliderRow label="浓淡" ariaLabel="阴影浓度" value={sh.opacity} min={0} max={1} step={0.05} onChange={(v) => set({ opacity: v })} />
      <CollapsibleColor value={sh.color} onChange={(c) => set({ color: c })} ariaLabel="阴影颜色" />
      <button
        onClick={() => patch({ shadow: undefined })}
        className="lift w-full rounded-lg border border-red-200/70 bg-red-50/70 px-2 py-1 text-xs text-red-500 shadow-sm hover:bg-red-100/80"
      >
        移除阴影
      </button>
    </div>
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
  const scaleSelection = useCanvasStore((s) => s.scaleSelection);
  const aiLockedIds = useCanvasStore((s) => s.aiLockedIds);

  // 钩子必须先于任何早退调用：空选区的早退返回不能改变钩子数量
  const [chartOpen, setChartOpen] = useState(false);
  const [dragLayer, setDragLayer] = useState<string | null>(null);

  const selected = selection.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is CanvasElement => Boolean(e));
  if (selected.length === 0) {
    return <div className="p-4 text-sm text-gray-400/90">未选中元素</div>;
  }
  const one = selected[0];
  const chartId = selected.find((e) => e.chartId)?.chartId;
  const multi = selected.length > 1;

  // 多选同类型 → 共享编辑器：patch 应用到全部选中元素（一次历史同步生效，改一个全部跟着变）；
  // 不同类型多选 → 不展示单元素编辑，由组合卡片接管（下方组合按钮）
  const sameType = multi && selected.every((e) => e.type === one.type);
  const patch = (p: Partial<CanvasElement>) => {
    if (sameType) {
      useCanvasStore.getState().updateElements(selection, p);
    } else {
      updateElement(one.id, p);
    }
  };
  // 当前选区内是否包含组合对象成员（任一元素带 groupId 即视为组合选中，展示移除组合入口）
  const groupId = selected.find((e) => e.groupId)?.groupId;
  const groupMembers = groupId ? doc.elements.filter((e) => e.groupId === groupId) : [];

  const isTextLike = one.type === "text" || one.type === "logic";

  return (
    <div className="space-y-3 p-3 text-sm">
      {/* 类型徽章 */}
      <header className="flex items-center gap-2">
        <span className="shrink-0 rounded-lg bg-blue-100/70 px-2 py-0.5 text-xs font-semibold text-blue-700">{TYPE_NAMES[one.type]}</span>
        {"text" in one && one.text && <span className="truncate text-xs text-gray-500">{one.text}</span>}
      </header>

      {/* 混合类型多选：不展示单元素编辑卡片，改为组合入口（同类多选才进入共享编辑模式） */}
      {(!multi || sameType) && (
        <>
      {/* 标题：逻辑节点标题或文字内容 + 字号样式（编辑面板第一位，优先于内部颜色等外观设置） */}
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

      {/* #87 三独立外观：内部（填充色/填充透明度/圆角）、边框（边框色/线宽/边框透明度/箭头样式）、
          整体（透明度/旋转/阴影）；无填充渲染的线条/位图省略内部卡，文字省略边框卡 */}
      {one.type !== "arrow" && one.type !== "polyline" && one.type !== "curve" && one.type !== "image" && (
        <Section title="内部">
          <CollapsibleColor value={one.fill} onChange={(c) => patch({ fill: c })} ariaLabel="填充色" />
          <SliderRow label="填充" ariaLabel="填充透明度" value={one.fillOpacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => patch({ fillOpacity: v })} />
          {(one.type === "rect" || one.type === "logic") && (
            <SliderRow label="圆角" ariaLabel="圆角" value={one.rx} min={0} max={50} step={1} onChange={(v) => patch({ rx: v })} />
          )}
          {one.type === "sector" && (
            <div className="space-y-1 text-xs text-gray-500/90">
              <div>圆心 ({Math.round(one.x)}, {Math.round(one.y)})　半径 {Math.round(one.radius)}</div>
              <div>角度 {Math.round((one.startAngle * 180) / Math.PI)}° → {Math.round((one.endAngle * 180) / Math.PI)}°</div>
            </div>
          )}
        </Section>
      )}

      {one.type !== "text" && (
        <Section title="边框">
          <CollapsibleColor value={one.stroke} onChange={(c) => patch({ stroke: c })} ariaLabel="边框色" />
          <SliderRow label="粗细" ariaLabel="线宽" value={one.strokeWidth} min={0} max={20} step={1} onChange={(v) => patch({ strokeWidth: v })} />
          <SliderRow label="边框" ariaLabel="边框透明度" value={one.strokeOpacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => patch({ strokeOpacity: v })} />
          {one.type === "arrow" && (
            <div className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 text-xs text-gray-500">样式</span>
              {([["none", "无箭头"], ["single", "单箭头"], ["double", "双箭头"]] as const).map(([h, label]) => (
                <button
                  key={h}
                  title={label}
                  onClick={() => patch({ head: h } as Partial<CanvasElement>)}
                  className={`lift rounded-lg border px-2 py-0.5 text-xs ${(one.head ?? "single") === h ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {one.type === "curve" && (
            <SliderRow label="弯曲" ariaLabel="弯曲度" value={one.curvature} min={-2} max={2} step={0.1} onChange={(v) => patch({ curvature: v } as Partial<CanvasElement>)} />
          )}
        </Section>
      )}

      <Section title="整体">
        <SliderRow label="透明" ariaLabel="透明度" value={one.opacity} min={0} max={1} step={0.05} onChange={(v) => patch({ opacity: v })} />
        {/* 整体颜色饱和度：同步调整填充色与边框色（保持色相/亮度），直观控制图标鲜艳度 */}
        <SliderRow
          label="饱和"
          ariaLabel="颜色饱和度"
          value={saturationOf(one.fill)}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => patch({ fill: adjustSaturation(one.fill, v), stroke: adjustSaturation(one.stroke, v) })}
        />
        {one.type !== "curve" && one.type !== "sector" && (
          <SliderRow label="旋转" ariaLabel="旋转" value={one.rotation} min={-360} max={360} step={1} onChange={(v) => patch({ rotation: v })} />
        )}
        <ShadowControls e={one} patch={patch} />
      </Section>

      {/* 外形：逻辑节点可选 矩形/正方形/长方形/平行四边形/菱形 */}
      {one.type === "logic" && (
        <Section title="外形">
          <div className="grid grid-cols-5 gap-1">
            {([
              ["rect", "矩形"],
              ["square", "正方形"],
              ["long", "长方形"],
              ["parallelogram", "平行四边形"],
              ["diamond", "菱形"],
            ] as const).map(([s, label]) => {
              const active = one.shape === "parallelogram" ? s === "parallelogram" : one.shape === "diamond" ? s === "diamond" : s === "rect" || s === "square" || s === "long";
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  title={label}
                  onClick={() => {
                    if (s === "parallelogram") patch({ shape: "parallelogram" });
                    else if (s === "diamond") patch({ shape: "diamond" });
                    else if (s === "square") patch({ shape: undefined, width: Math.max(one.width, one.height), height: Math.max(one.width, one.height) });
                    else if (s === "long") patch({ shape: undefined });
                    else patch({ shape: undefined });
                  }}
                  className={`lift rounded-lg border px-1 py-0.5 text-[11px] ${active ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
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
        </>
      )}

      {/* 组合对象卡片：已选组合成员 → 显示组合信息 + 移除组合；不同类型多选 → 组合入口 */}
      <Section title="组合">
        {groupId ? (
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-gray-400">组合对象：{groupMembers.length} 个元素整体选中/移动/编辑</p>
            <button
              onClick={() => {
                useCanvasStore.getState().ungroupElements(groupId);
                setSelection(groupMembers.map((e) => e.id));
              }}
              className="lift rounded-lg border border-red-200/70 bg-red-50/60 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100/60"
              data-testid="ungroup"
            >
              移除组合（拆为独立元素）
            </button>
          </div>
        ) : multi && !sameType ? (
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-gray-400">已选 {selected.length} 个不同类型元素，可组合为整体对象（单击任一个即全选、整体移动）</p>
            <button
              onClick={() => useCanvasStore.getState().groupElements(selection)}
              className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white"
              data-testid="group"
            >
              组合为整体对象
            </button>
          </div>
        ) : (
          <p className="text-[10px] leading-relaxed text-gray-400">选中多个元素后可组合为整体对象</p>
        )}
      </Section>

      {multi && (
        <Section title="排列">
          <div className="flex flex-wrap gap-1">
            <button onClick={() => useCanvasStore.getState().rotateSelection(-15)} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">左旋 15°</button>
            <button onClick={() => useCanvasStore.getState().rotateSelection(15)} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-gray-600 shadow-sm hover:bg-white/90">右旋 15°</button>
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
          <p className="text-[10px] leading-relaxed text-gray-400">拖动扇形/柱体可直接改数值；改数据图形自动重排</p>
          <button
            onClick={() => useCanvasStore.getState().detachChart(chartId)}
            className="lift rounded-lg border border-red-200/70 bg-red-50/60 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100/60"
            data-testid="detach-chart"
          >
            解除图表关联（变为普通元素）
          </button>
        </Section>
      )}

      {/* 层级：优先级排序——列表顶部 = 最顶层、底部 = 最底层，拖拽条目调整遮挡顺序（drop 时一步撤销）。
          只列出与选中元素包围盒重叠的元素（互相遮挡的才有排序意义），避免长列表淹没 */}
      <Section title="层级">
        <p className="text-[10px] leading-relaxed text-gray-400">仅显示与选中元素重叠的条目；顶部 = 最顶层、底部 = 最底层，拖动调整遮挡顺序</p>
        <ul className="space-y-1">
          {[...doc.elements]
            .filter((el) => {
              const b = lineBounds(el);
              // 与任一选中元素 bbox 相交（含选中元素自身）
              return selected.some((s) => {
                const sb = lineBounds(s);
                return b.x < sb.x + sb.width && b.x + b.width > sb.x && b.y < sb.y + sb.height && b.y + b.height > sb.y;
              });
            })
            .sort((x, y) => y.zIndex - x.zIndex).map((el, i, list) => {
            const locked = aiLockedIds.includes(el.id);
            return (
              <li
                key={el.id}
                data-testid="layer-item"
                data-element-id={el.id}
                draggable={!locked}
                title={locked ? "AI 生成中，暂不可调整层级" : "拖动调整层级，点击选中"}
                onClick={() => setSelection([el.id])}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", el.id);
                  setDragLayer(el.id);
                }}
                onDragOver={(e) => {
                  if (!dragLayer || dragLayer === el.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragLayer ?? e.dataTransfer.getData("text/plain");
                  if (src && src !== el.id) {
                    const order = [...doc.elements].sort((x, y) => y.zIndex - x.zIndex).map((l) => l.id);
                    const from = order.indexOf(src);
                    const to = order.indexOf(el.id);
                    if (from >= 0 && to >= 0) {
                      order.splice(from, 1);
                      order.splice(to, 0, src);
                      useCanvasStore.getState().reorderElements(order);
                    }
                  }
                  setDragLayer(null);
                }}
                onDragEnd={() => setDragLayer(null)}
                className={`lift flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                  selection.includes(el.id) ? "border-blue-300 bg-blue-50 text-gray-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"
                } ${locked ? "opacity-60" : ""}`}
              >
                <span className="shrink-0 rounded bg-gray-100/90 px-1 py-0.5 text-[10px] text-gray-500">{TYPE_NAMES[el.type]}</span>
                <span className="min-w-0 flex-1 truncate">{"text" in el && el.text ? el.text : TYPE_NAMES[el.type]}</span>
                {i === 0 && <span className="shrink-0 text-[10px] text-blue-500">顶层</span>}
                {i === list.length - 1 && list.length > 1 && (
                  <span className="shrink-0 text-[10px] text-gray-400">底层</span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="操作">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => (chartId ? useCanvasStore.getState().flipChart(chartId, "h") : patch({ flipH: !one.flipH }))}
            title="水平镜像"
            aria-pressed={chartId ? !!doc.charts?.[chartId]?.flipH : !!one.flipH}
            className={`lift flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${
              (chartId ? !!doc.charts?.[chartId]?.flipH : !!one.flipH) ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v18" />
              <path d="M5 8l-3 4 3 4" />
              <path d="M19 8l3 4-3 4" />
            </svg>
            水平
          </button>
          <button
            onClick={() => (chartId ? useCanvasStore.getState().flipChart(chartId, "v") : patch({ flipV: !one.flipV }))}
            title="垂直镜像"
            aria-pressed={chartId ? !!doc.charts?.[chartId]?.flipV : !!one.flipV}
            className={`lift flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${
              (chartId ? !!doc.charts?.[chartId]?.flipV : !!one.flipV) ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"
            }`}
          >
            <svg data-testid="flip-v-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* 与水平镜像同一套开放箭头语言：中轴水平，箭头围绕 x=12 上下对称。 */}
              <path d="M3 12h18" />
              <path d="m8 7 4-4 4 4" />
              <path d="m8 17 4 4 4-4" />
            </svg>
            垂直
          </button>
          <button
            onClick={() => deleteElements(selection)}
            title="删除选中元素"
            className="lift flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200/70 bg-red-50/70 text-xs font-medium text-red-500 shadow-sm transition-colors hover:bg-red-100/80"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            删除
          </button>
          <button
            onClick={() => setSelection([])}
            title="取消选择"
            className="lift flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-white/70 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-white/90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9 9l6 6M15 9l-6 6" />
            </svg>
            取消
          </button>
          {/* 多选/组合/图标整体缩放：绕包围盒中心放大/缩小，一步撤销 */}
          <button
            onClick={() => scaleSelection(1.1)}
            title="放大选中（多选/组合整体）"
            className="lift flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-white/70 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-white/90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
              <path d="M11 8v6M8 11h6" />
            </svg>
            放大
          </button>
          <button
            onClick={() => scaleSelection(0.9)}
            title="缩小选中（多选/组合整体）"
            className="lift flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-white/70 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-white/90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
              <path d="M8 11h6" />
            </svg>
            缩小
          </button>
        </div>
      </Section>

      <ChartDialog open={chartOpen} chartId={chartId} initial={chartId ? doc.charts?.[chartId] ?? null : null} onClose={() => setChartOpen(false)} />
    </div>
  );
}
