"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { layoutChart, CHART_PALETTE, CHART_STROKE_PALETTE, type ChartSpec, type ChartDatum } from "@/lib/canvas/chartLayout";
import { elementBounds, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from "@/lib/canvas/geometry";
import { elementToSvg } from "@/lib/canvas/exporter";
import { useCanvasStore } from "@/lib/canvas/store";
import { newId } from "@/lib/canvas/elements";
import type { CanvasElement } from "@/lib/canvas/types";

interface Row { label: string; value: string; series: string; color: string }

// 类型二级菜单（变体）：饼图支持 实心/空心（圆环）
const TYPE_VARIANTS: { type: ChartSpec["type"]; options: { value?: string; label: string }[] }[] = [
  { type: "bar", options: [{ label: "分组柱状" }, { value: "stacked", label: "堆叠柱状" }] },
  { type: "pie", options: [{ label: "实心饼图" }, { value: "hollow", label: "空心饼图" }] },
];

// 图表类型迷你预览图标：每种图表一个小示意图（配色与真实图表一致：浅色填充 + 深色描边）
const AXIS = "#2f2f2f";
const STROKES = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6"];
const FILLS = ["#eef4ff", "#f0fff0", "#fff8e6", "#f3efff"];

const TYPE_ICONS: Record<ChartSpec["type"], ReactNode> = {
  bar: (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 20.5h19" stroke={AXIS} strokeWidth="1.5" />
      <rect x="4" y="13" width="4.2" height="7" fill={FILLS[0]} stroke={AXIS} strokeWidth="1" />
      <rect x="10" y="8.5" width="4.2" height="11.5" fill={FILLS[1]} stroke={AXIS} strokeWidth="1" />
      <rect x="16" y="10.5" width="4.2" height="9.5" fill={FILLS[2]} stroke={AXIS} strokeWidth="1" />
    </svg>
  ),
  line: (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 20.5h19" stroke={AXIS} strokeWidth="1.5" />
      <polyline points="4.5,16 10,9.5 15,13 19.5,6.5" fill="none" stroke={STROKES[0]} strokeWidth="1.8" />
      <circle cx="4.5" cy="16" r="1.6" fill="#fff" stroke={STROKES[0]} strokeWidth="1" />
      <circle cx="10" cy="9.5" r="1.6" fill="#fff" stroke={STROKES[0]} strokeWidth="1" />
      <circle cx="15" cy="13" r="1.6" fill="#fff" stroke={STROKES[0]} strokeWidth="1" />
      <circle cx="19.5" cy="6.5" r="1.6" fill="#fff" stroke={STROKES[0]} strokeWidth="1" />
    </svg>
  ),
  pie: (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12 L12 3 A9 9 0 0 1 19.79 16.5 Z" fill={FILLS[0]} stroke={AXIS} strokeWidth="1" />
      <path d="M12 12 L19.79 16.5 A9 9 0 0 1 4.21 16.5 Z" fill={FILLS[1]} stroke={AXIS} strokeWidth="1" />
      <path d="M12 12 L4.21 16.5 A9 9 0 0 1 12 3 Z" fill={FILLS[2]} stroke={AXIS} strokeWidth="1" />
    </svg>
  ),
  scatter: (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 20.5h19" stroke={AXIS} strokeWidth="1.5" />
      <circle cx="5" cy="9" r="2.2" fill={STROKES[0]} stroke={AXIS} strokeWidth="1" />
      <circle cx="10" cy="15.5" r="2.2" fill={STROKES[1]} stroke={AXIS} strokeWidth="1" />
      <circle cx="15" cy="7" r="2.2" fill={STROKES[2]} stroke={AXIS} strokeWidth="1" />
      <circle cx="19.5" cy="12.5" r="2.2" fill={STROKES[3]} stroke={AXIS} strokeWidth="1" />
    </svg>
  ),
};

const CHART_TYPES: { type: ChartSpec["type"]; label: string }[] = [
  { type: "bar", label: "柱状图" },
  { type: "line", label: "折线图" },
  { type: "pie", label: "饼图" },
  { type: "scatter", label: "散点图" },
];

function emptyRows(): Row[] {
  return [
    { label: "", value: "", series: "", color: "" },
    { label: "", value: "", series: "", color: "" },
  ];
}

export default function ChartDialog({
  open, chartId, initial, onClose,
}: {
  open: boolean;
  chartId?: string;
  initial?: ChartSpec | null;
  onClose: () => void;
}) {
  const [type, setType] = useState<ChartSpec["type"]>("bar");
  const [variant, setVariant] = useState<string | undefined>(undefined);
  // 二级菜单：当前展开变体选项的类型卡片（null = 收起）
  const [openMenu, setOpenMenu] = useState<ChartSpec["type"] | null>(null);
  // 图表尺寸缩放（实时预览 + 生成时写入 at.scale）
  const [scale, setScale] = useState(1);
  const [title, setTitle] = useState("");
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [showValues, setShowValues] = useState(false);
  const [xStep, setXStep] = useState<number | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>(emptyRows());
  const [err, setErr] = useState("");
  // 实时预览视口：拖拽平移（pan）+ 滚轮缩放（scale 联动，确定后图表即此大小）
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.type);
      setVariant(initial.variant);
      setTitle(initial.title ?? "");
      setXLabel(initial.xLabel ?? "");
      setYLabel(initial.yLabel ?? "");
      setUnit(initial.unit ?? "");
      setShowValues(initial.showValues ?? false);
      setXStep(initial.xStep);
      setRows(initial.data.map((d) => ({ label: d.label, value: String(d.value), series: d.series ?? "", color: d.color ?? "" })));
    } else {
      setType("bar");
      setVariant(undefined);
      setTitle("");
      setXLabel("");
      setYLabel("");
      setUnit("");
      setShowValues(false);
      setXStep(undefined);
      setRows(emptyRows());
    }
    setErr("");
  }, [open, initial]);

  // 饼图没有坐标轴、不用系列分组——隐藏无意义字段，避免用户困惑
  const isPie = type === "pie";

  const setRow = (i: number, k: keyof Row, v: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };

  // 自动配色：与 layoutChart 完全一致——折线/散点用深描边色板，其余用浅填充色板。
  // 饼图按行序轮换（每个数据项一个色）；直角坐标系按系列分配（同一系列共用色）；
  // 全部行都未填系列时按行序轮换（默认两行颜色不同，生成时行色生效）
  const autoColor = (rowIdx: number) => {
    const useStroke = type === "line" || type === "scatter";
    const palette = useStroke ? CHART_STROKE_PALETTE : CHART_PALETTE;
    if (isPie) return palette[rowIdx % palette.length];
    const hasSeries = rows.some((r) => r.series.trim() !== "");
    if (!hasSeries) return palette[rowIdx % palette.length];
    const seriesNames = Array.from(new Set(rows.map((r) => r.series.trim() || "默认")));
    const si = Math.max(0, seriesNames.indexOf((rows[rowIdx]?.series ?? "").trim() || "默认"));
    return palette[si % palette.length];
  };

  // 实时预览：用当前表单状态构建 spec，layoutChart 生成元素后渲染迷你 SVG（所见即所得）
  const previewSvg = useMemo(() => {
    try {
      const data: ChartDatum[] = [];
      for (const r of rows) {
        const label = r.label.trim();
        if (!label || r.value.trim() === "") return null;
        const v = Number(r.value);
        if (!Number.isFinite(v) || v < 0) return null;
        data.push({ label, value: v, series: isPie ? undefined : r.series.trim() || undefined, color: r.color.trim() || undefined });
      }
      if (data.length < 1 || data.reduce((s, d) => s + d.value, 0) <= 0) return null;
      const spec: ChartSpec = {
        type,
        variant,
        data,
        title: title.trim() || undefined,
        xLabel: isPie ? undefined : xLabel.trim() || undefined,
        yLabel: isPie ? undefined : yLabel.trim() || undefined,
        xStep,
        // 预览不缩放元素（缩放交给 CSS transform，避免放大后超出 viewBox 被裁剪）；
        // 最终生成仍用 at.scale，视觉大小与预览一致
      };
      const els = layoutChart(spec, "preview");
      return els.map((e) => elementToSvg(e)).join("\n");
    } catch {
      return null;
    }
  }, [type, variant, rows, title, xLabel, yLabel, isPie, scale]);

  // 关闭时不渲染弹窗：必须在所有 hooks 之后 return（useMemo 提前 return 会触发
  // "Rendered more hooks than during the previous render"，open 切换时崩溃）
  if (!open) return null;

  const submit = () => {
    const data: ChartDatum[] = [];
    for (const r of rows) {
      const label = r.label.trim();
      if (!label) { setErr("分类标签不能为空"); return; }
      if (r.value.trim() === "") { setErr("数值不能为空"); return; }
      const v = Number(r.value);
      if (!Number.isFinite(v)) { setErr("数值必须是数字"); return; }
      if (v < 0) { setErr("数值必须是非负数字"); return; }
      data.push({ label, value: v, series: isPie ? undefined : r.series.trim() || undefined, color: r.color.trim() || undefined });
    }
    if (data.length < 1) { setErr("至少 1 行数据"); return; }
    if (data.reduce((s, d) => s + d.value, 0) <= 0) { setErr("数据总和必须大于 0"); return; }
    // 尺寸滑块：合并进 at.scale（保留已有位置偏移）；新建时把图表几何中心对准当前视口中心
    const prevAt = chartId ? useCanvasStore.getState().doc.charts?.[chartId]?.at : undefined;
    const id = chartId ?? newId();
    // 图表声明主体（不含 at）：居中计算与最终布局必须用同一份字段（xLabel/yLabel/unit 等会改变
    // 包围盒中心——此前 base 只带部分字段导致中心算偏，图表落点偏离视口中心）
    const baseSpec: ChartSpec = {
      type,
      variant,
      data,
      title: title.trim() || undefined,
      xLabel: isPie ? undefined : xLabel.trim() || undefined,
      yLabel: isPie ? undefined : yLabel.trim() || undefined,
      unit: unit.trim() || undefined,
      showValues: showValues || undefined,
      xStep,
    };
    let at: ChartSpec["at"] = { ...(prevAt ?? {}), scale };
    if (!chartId) {
      // 新建图表：先以完整声明布局算出图表包围盒中心，再整体平移到视口中心（世界坐标）
      const base = layoutChart(baseSpec, id);
      const bs = base.map(elementBounds);
      const cx = (Math.min(...bs.map((b) => b.x)) + Math.max(...bs.map((b) => b.x + b.width))) / 2;
      const cy = (Math.min(...bs.map((b) => b.y)) + Math.max(...bs.map((b) => b.y + b.height))) / 2;
      const v = useCanvasStore.getState().view;
      const vcx = (VIEWPORT_WIDTH / 2 - v.ox) / v.scale;
      const vcy = (VIEWPORT_HEIGHT / 2 - v.oy) / v.scale;
      // layoutChart 的 at 位移是加在缩放后坐标上的平移量：中心 = cx*scale + x，令其等于视口中心
      at = { scale, x: vcx - cx * scale, y: vcy - cy * scale };
    }
    const spec: ChartSpec = {
      ...baseSpec,
      at,
      // 编辑已有图表时携带当前 pieStart（旋转过接缝后重排不跳回原位）
      ...(chartId ? { pieStart: useCanvasStore.getState().doc.charts?.[chartId]?.pieStart } : {}),
    };
    const elements: CanvasElement[] = layoutChart(spec, id);
    const replaceIds = chartId
      ? useCanvasStore.getState().doc.elements.filter((e) => e.chartId === chartId).map((e) => e.id)
      : [];
    useCanvasStore.getState().applyChartEdit(id, spec, elements, replaceIds);
    onClose();
  };

  const inputCls = "h-7 rounded-lg border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="chart-dialog" onClick={onClose}>
      <div className="glass-panel max-h-[85vh] w-[50rem] max-w-[94vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-gray-800">{chartId ? "编辑图表数据" : "生成图表"}</h3>
        <div className="flex gap-4">
          {/* 左：表单 */}
          <div className="min-w-0 flex-1">

        {/* 图表类型：图标卡片（迷你图表预览 + 名称），有变体的类型从卡片展开二级菜单 */}
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">图表类型</div>
        <div className="mb-4 grid grid-cols-4 gap-2">
          {CHART_TYPES.map(({ type: t, label }) => {
            const active = type === t;
            const variants = TYPE_VARIANTS.find((v) => v.type === t)?.options ?? [];
            const menuOpen = openMenu === t;
            return (
              <div key={t} className="relative">
                <button
                  title={label}
                  aria-pressed={active}
                  onClick={() => {
                    if (type !== t) {
                      // 切换到其他类型：重置变体（柱→饼的 hollow 不适用），有变体则展开二级菜单
                      setType(t);
                      setVariant(undefined);
                      setOpenMenu(variants.length > 0 ? t : null);
                    } else {
                      // 点击当前类型卡片：只切换二级菜单开合，保留已选变体（不再重置）
                      setOpenMenu(menuOpen || variants.length === 0 ? null : t);
                    }
                  }}
                  className={`lift flex w-full flex-col items-center gap-1 rounded-xl border py-2 transition-colors ${
                    active || menuOpen ? "border-blue-400 bg-blue-50 shadow-sm" : "border-white/60 bg-white/70 hover:bg-white/90"
                  }`}
                >
                  {TYPE_ICONS[t]}
                  <span className={`flex items-center gap-0.5 text-xs ${active || menuOpen ? "font-medium text-blue-700" : "text-gray-500"}`}>
                    {label}
                    {variants.length > 0 && (
                      <span aria-hidden="true" className={`text-[9px] transition-transform ${menuOpen ? "rotate-180" : ""}`}>▾</span>
                    )}
                  </span>
                </button>
                {/* 二级菜单：从卡片下方展开变体选项（如饼图 实心/空心） */}
                {menuOpen && variants.length > 0 && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-[6.5rem] overflow-hidden rounded-lg border border-white/60 bg-white/90 shadow-lg backdrop-blur-xl">
                    {variants.map((opt) => {
                      const optActive = (opt.value ?? undefined) === variant;
                      return (
                        <button
                          key={opt.label}
                          aria-pressed={optActive}
                          onClick={() => { setVariant(opt.value); setOpenMenu(null); }}
                          className={`lift flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs ${
                            optActive ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-white/80"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${optActive ? "bg-blue-600" : "bg-gray-300"}`} />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 图表信息：标题 + 坐标轴名（饼图无坐标轴，只显示标题）+ 数值单位。
            单位独立一行——与 X/Y 轴同排会因三个 flex-1 过挤溢出到右侧预览列 */}
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">图表信息</div>
        <div className="mb-4 space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            标题
            <input value={title} aria-label="图表标题" onChange={(e) => setTitle(e.target.value)} className={`flex-1 ${inputCls}`} />
          </label>
          {!isPie && (
            <div className="flex gap-2">
              <label className="flex flex-1 items-center gap-2 text-xs text-gray-500">
                X 轴
                <input value={xLabel} aria-label="X 轴名" onChange={(e) => setXLabel(e.target.value)} className={`flex-1 ${inputCls}`} />
              </label>
              <label className="flex flex-1 items-center gap-2 text-xs text-gray-500">
                Y 轴
                <input value={yLabel} aria-label="Y 轴名" onChange={(e) => setYLabel(e.target.value)} className={`flex-1 ${inputCls}`} />
              </label>
            </div>
          )}
          {/* 数值单位（饼图标签显示为 数值单位 (百分比)，如 50万元 (25%)）：独立一行避免溢出 */}
          <label className="flex items-center gap-2 text-xs text-gray-500">
            单位
            <input value={unit} aria-label="数值单位" placeholder="如 万元/人/%" onChange={(e) => setUnit(e.target.value)} className={`flex-1 ${inputCls}`} />
          </label>
          {isPie && (
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" aria-label="饼图显示具体数据" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
              饼图标签显示具体数据（默认只显示占比）
            </label>
          )}
        </div>

        {/* 数据表：列头随类型显示（饼图隐藏系列列）+ 每条目图例颜色；列头与输入行同结构逐列对齐 */}
        <div className="mb-1 flex gap-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          <span className="flex-1">标签</span>
          <span className="w-16 text-right">数值</span>
          {!isPie && <span className="w-24 text-right">分组（可选）</span>}
          <span className="w-14 text-right">颜色</span>
          {/* 与输入行删除按钮等宽的占位，保证颜色列头对齐 */}
          <span className="w-6 shrink-0" />
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`标签 ${i + 1}`} value={r.label} onChange={(e) => setRow(i, "label", e.target.value)} className={`h-7 min-w-0 flex-1 ${inputCls}`} />
              <input aria-label={`数值 ${i + 1}`} value={r.value} onChange={(e) => setRow(i, "value", e.target.value)} className={`h-7 w-16 text-right ${inputCls}`} />
              {!isPie && (
                <input aria-label={`分组 ${i + 1}`} value={r.series} onChange={(e) => setRow(i, "series", e.target.value)} className={`h-7 w-24 ${inputCls}`} />
              )}
              {/* 图例颜色：整块为色块 + 隐藏的取色器输入（透明铺满，点击任意处打开取色器，无小方块残留） */}
              <label aria-label={`颜色 ${i + 1}`} className="relative flex h-7 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-white/60 bg-white/70" style={{ backgroundColor: r.color || autoColor(i) }}>
                <input type="color" value={r.color || autoColor(i)} onChange={(e) => setRow(i, "color", e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              </label>
              <button
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                disabled={rows.length <= 1}
                className="lift flex h-7 w-6 shrink-0 items-center justify-center rounded-lg text-xs text-gray-400 hover:text-red-500 disabled:opacity-30"
                title="删除行"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {/* 添加行：自动预填下一个自动配色（新建标签自动换好颜色）；无数据量上限，可添加任意多行 */}
        <button
          onClick={() => setRows((rs) => [...rs, { label: "", value: "", series: "", color: autoColor(rs.length) }])}
          className="mt-2 lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-xs text-gray-600 hover:bg-white/90"
        >
          + 添加行
        </button>

        {err && <div className="mt-2 rounded-lg border border-red-200/60 bg-red-100/40 px-2 py-1 text-xs text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600">取消</button>
          <button onClick={submit} className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white">{chartId ? "保存修改" : "生成图表"}</button>
        </div>
          </div>
          {/* 右：实时预览 + 尺寸 */}
          <div className="w-72 shrink-0 space-y-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">实时预览</div>
            {/* 预览视口平移（拖拽）+ 滚轮缩放（联动 scale，确定后图表即此大小） */}
            <div
              className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/60 bg-white/70 p-2 shadow-inner active:cursor-grabbing"
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                setScale((s) => Math.min(2, Math.max(0.3, +(s * factor).toFixed(2))));
              }}
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                const d = dragRef.current;
                setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              {previewSvg ? (
                // 缩放用 CSS transform（内容不放大出 viewBox，不会被裁剪）；transform-origin 0 0 保证
                // 滚轮缩放以左上角为基准整体放大缩小，拖动平移可查看全部内容
                <svg viewBox="0 0 1600 1000" className="h-56 w-full" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0" }} dangerouslySetInnerHTML={{ __html: previewSvg }} />
              ) : (
                <div className="flex h-56 items-center justify-center text-xs text-gray-400">填写数据后实时预览</div>
              )}
              {/* 拖拽/缩放提示 */}
              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-white/70 px-1 text-[9px] text-gray-400">拖拽平移 · 滚轮缩放</span>
            </div>
            {/* 尺寸滑块：缩放整图（预览同步） */}
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">尺寸</div>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <span className="shrink-0">0.3</span>
              <input
                type="range"
                aria-label="图表尺寸"
                min={0.3}
                max={2}
                step={0.05}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="flex-1 accent-blue-600"
              />
              <span className="shrink-0">2.0</span>
              <span className="w-12 text-right font-medium text-blue-700">{scale.toFixed(2)}×</span>
            </label>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
