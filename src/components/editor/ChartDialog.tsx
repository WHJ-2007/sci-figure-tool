"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { layoutChart, chartElemKey, CHART_PALETTE, CHART_STROKE_PALETTE, type ChartSpec, type ChartDatum } from "@/lib/canvas/chartLayout";
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
  // 预览内元素级微调：选中元素拖动/缩放/改字号后按稳定键记录，实时反映到预览与最终生成
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 悬停高亮：鼠标悬停命中层时浅蓝描边提示可点击（提升交互可发现性，未选中时也看得见）
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<Record<string, { x?: number; y?: number; width?: number; height?: number; fontSize?: number }>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 预览渲染比例：每 1 个 viewBox 单位对应的屏幕像素（viewBox 1600×1000 渲染到 w-full 容器会被等比压缩，
  // 手柄/描边若按 viewBox 单位写死会小到看不见）。用 ResizeObserver 实测 SVG 渲染盒换算，保证屏幕恒定大小
  const [pxPerUnit, setPxPerUnit] = useState(0.2);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = svgRef.current?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        setPxPerUnit(Math.min(r.width / 1600, r.height / 1000));
      }
    };
    measure();
    const svg = svgRef.current;
    if (typeof ResizeObserver !== "undefined" && svg) {
      const ro = new ResizeObserver(measure);
      ro.observe(svg);
      return () => ro.disconnect();
    }
    return undefined;
  }, [open]);
  // 预览容器：原生非 passive wheel 监听（React onWheel 是 passive，preventDefault 失效，
  // 悬停预览滚动会带动整页滚动）；阻止默认滚动并联动 scale 缩放
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = previewBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setScale((s) => Math.min(2, Math.max(0.3, +(s * factor).toFixed(2))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);
  // 统一拖拽手势：mode=pan 平移预览 / move 移动元素 / resize 拖手柄缩放元素
  const dragRef = useRef<{
    mode: "pan" | "move" | "resize";
    key: string;
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    dir: string; // resize 方向：nw / n / ne / e / se / s / sw / w
    panX: number;
    panY: number;
    // move/resize 起点处的既有偏移（叠加增量，支持连续拖动）
    baseX: number;
    baseY: number;
    baseW: number;
    baseH: number;
  } | null>(null);

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
      // 打开已有图表：加载已保存的元素级微调（预览内拖动/缩放/字号跨会话保留）
      setAdjust(initial.elementAdjust ?? {});
      // 尺寸跨会话保留：加载保存的 at.scale（用户调整过大小后下次编辑不再重置回 1×）
      setScale(initial.at?.scale ?? 1);
      setPan({ x: 0, y: 0 });
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
      setAdjust({});
    }
    setSelectedKey(null);
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

  // 实时预览：用当前表单状态构建 spec，layoutChart 生成元素（保留数组供命中层/选中框/拖拽交互用）
  const previewEls = useMemo(() => {
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
      return layoutChart(spec, "preview");
    } catch {
      return null;
    }
  }, [type, variant, rows, title, xLabel, yLabel, isPie]);

  // 应用用户微调后的元素（命中层/选中框/底图共用同一份，所见即所得）；
  // 键 = chartElemKey（bind.role+index 或 type+index），布局重算后仍能对上；
  // 语义 = 相对默认布局的偏移量（与 layoutChart 的 applyElementAdjust 一致）
  const adjustedEls = useMemo(() => {
    if (!previewEls) return [];
    return previewEls.map((e, i) => {
      const a = adjust[chartElemKey(e, i)];
      if (!a) return e;
      const n = { ...e } as CanvasElement;
      if (a.x !== undefined) n.x = e.x + a.x;
      if (a.y !== undefined) n.y = e.y + a.y;
      if (a.width !== undefined) n.width = Math.max(1, e.width + a.width);
      if (a.height !== undefined) n.height = Math.max(1, e.height + a.height);
      if (a.fontSize !== undefined && "fontSize" in n) n.fontSize = Math.max(6, (n.fontSize ?? 12) + a.fontSize);
      return n;
    });
  }, [previewEls, adjust]);

  const previewSvg = useMemo(
    () => (adjustedEls.length ? adjustedEls.map((e) => elementToSvg(e)).join("\n") : null),
    [adjustedEls]
  );

  // 打开预览后自动选中首个文字元素（有 fontSize 的元素）：手柄与字号控件立即可见，无需先点击；
  // 表单变化重算布局时若当前选中键已失效则回落到首个文字元素，保证交互不消失
  useEffect(() => {
    if (!open || !previewEls || previewEls.length === 0) return;
    const valid = selectedKey && adjustedEls.some((e, i) => chartElemKey(e, i) === selectedKey);
    if (valid) return;
    const textIdx = previewEls.findIndex((e) => "fontSize" in e);
    const idx = textIdx >= 0 ? textIdx : 0;
    setSelectedKey(chartElemKey(previewEls[idx], idx));
    // 布局重算导致选中键变化时，微调保留（键 = bind.role+index 稳定，仅无 bind 元素按位置回落）
  }, [open, previewEls, adjustedEls, selectedKey]);

  // 屏幕坐标 → SVG viewBox 坐标：优先 getScreenCTM 精确反算（含 CSS transform 与 preserveAspectRatio），
  // 兜底按 boundingRect 比例（jsdom 等无 CTM 环境）；预览 SVG viewBox 恒为 1600×1000
  const toView = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (svg) {
      try {
        const ctm = svg.getScreenCTM?.();
        if (ctm && typeof DOMPoint !== "undefined") {
          const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
          return { x: p.x, y: p.y };
        }
      } catch {
        // CTM 反算失败则走比例兜底
      }
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) {
        return { x: ((clientX - r.left) / r.width) * 1600, y: ((clientY - r.top) / r.height) * 1000 };
      }
    }
    return { x: clientX, y: clientY };
  };

  // 命中层点击：选中该元素并开始拖动（move）；空白处由容器兜底为 pan
  const startElementDrag = (e: React.PointerEvent, i: number) => {
    if (!previewEls) return;
    e.stopPropagation();
    const el = previewEls[i];
    const key = chartElemKey(el, i);
    const p = toView(e.clientX, e.clientY);
    const base = adjust[key] ?? {};
    setSelectedKey(key);
    dragRef.current = {
      mode: "move",
      key,
      clientX: e.clientX,
      clientY: e.clientY,
      startX: p.x,
      startY: p.y,
      startW: 0,
      startH: 0,
      dir: "",
      panX: pan.x,
      panY: pan.y,
      baseX: base.x ?? 0,
      baseY: base.y ?? 0,
      baseW: base.width ?? 0,
      baseH: base.height ?? 0,
    };
  };

  // 缩放手柄：开始 resize（dir 为 8 向之一）
  const startResize = (e: React.PointerEvent, i: number, dir: string) => {
    if (!previewEls) return;
    e.stopPropagation();
    const el = previewEls[i];
    const key = chartElemKey(el, i);
    const p = toView(e.clientX, e.clientY);
    const base = adjust[key] ?? {};
    setSelectedKey(key);
    dragRef.current = {
      mode: "resize",
      key,
      clientX: e.clientX,
      clientY: e.clientY,
      startX: p.x,
      startY: p.y,
      startW: 0,
      startH: 0,
      dir,
      panX: pan.x,
      panY: pan.y,
      baseX: base.x ?? 0,
      baseY: base.y ?? 0,
      baseW: base.width ?? 0,
      baseH: base.height ?? 0,
    };
  };

  // 拖动中：move 更新 x/y 偏移；resize 按方向更新 width/height（同步对角 x/y）
  const onPreviewMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toView(e.clientX, e.clientY);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    if (d.mode === "pan") {
      setPan({ x: d.panX + (e.clientX - d.clientX), y: d.panY + (e.clientY - d.clientY) });
      return;
    }
    if (d.mode === "move") {
      setAdjust((prev) => ({ ...prev, [d.key]: { ...(prev[d.key] ?? {}), x: d.baseX + dx, y: d.baseY + dy } }));
      return;
    }
    if (d.mode === "resize") {
      const dir = d.dir;
      let x = d.baseX, y = d.baseY, w = d.baseW, h = d.baseH;
      if (dir.includes("e")) w = d.baseW + dx;
      if (dir.includes("s")) h = d.baseH + dy;
      if (dir.includes("w")) { w = d.baseW - dx; x = d.baseX + dx; }
      if (dir.includes("n")) { h = d.baseH - dy; y = d.baseY + dy; }
      setAdjust((prev) => ({ ...prev, [d.key]: { ...(prev[d.key] ?? {}), x, y, width: Math.max(1, w), height: Math.max(1, h) } }));
    }
  };

  const endDrag = () => { dragRef.current = null; };

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
      // 元素级微调（预览内拖动/缩放/改字号）写入图表声明：layoutChart 应用，重排后仍保留
      ...(Object.keys(adjust).length ? { elementAdjust: adjust } : {}),
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
      <div className="glass-panel max-h-[85vh] w-[58rem] max-w-[94vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
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
          <div className="w-[21rem] shrink-0 space-y-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">实时预览</div>
            {/* 预览视口平移（拖拽）+ 滚轮缩放（联动 scale，确定后图表即此大小）；
                元素级编辑：点击选中元素，拖动调整位置，拖 8 向手柄调整大小。
                wheel 用原生非 passive 监听（见 previewBoxRef effect）：悬停预览滚动不带动整页 */}
            <div
              ref={previewBoxRef}
              className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/60 bg-white/70 p-2 shadow-inner active:cursor-grabbing"
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                dragRef.current = { mode: "pan", key: "", clientX: e.clientX, clientY: e.clientY, startX: 0, startY: 0, startW: 0, startH: 0, dir: "", panX: pan.x, panY: pan.y, baseX: 0, baseY: 0, baseW: 0, baseH: 0 };
              }}
              onPointerMove={onPreviewMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {previewSvg ? (
                // 缩放用 CSS transform（内容不放大出 viewBox，不会被裁剪）；transform-origin 0 0 保证
                // 滚轮缩放以左上角为基准整体放大缩小，拖动平移可查看全部内容
                <svg ref={svgRef} viewBox="0 0 1600 1000" className="h-80 w-full" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0" }}>
                  <g dangerouslySetInnerHTML={{ __html: previewSvg }} />
                  {/* 命中层：透明矩形覆盖每个元素，点击选中并拖动移动（pan 由容器兜底） */}
                  {adjustedEls.map((el, i) => {
                    const b = elementBounds(el);
                    const key = chartElemKey(el, i);
                    const hovered = hoverKey === key;
                    return (
                      <g key={`hitg-${i}`}>
                        {/* 悬停高亮框：未选中时也提示该元素可点击/拖动 */}
                        {hovered && selectedKey !== key && (
                          <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="#93c5fd" strokeWidth={Math.max(1, 1.5 / pxPerUnit)} strokeDasharray={`${Math.max(3, 5 / pxPerUnit)} ${Math.max(2, 3 / pxPerUnit)}`} pointerEvents="none" />
                        )}
                        <rect
                          data-testid={`chart-hit-${i}`}
                          x={b.x}
                          y={b.y}
                          width={b.width}
                          height={b.height}
                          fill="transparent"
                          className="cursor-move"
                          onPointerEnter={() => setHoverKey(key)}
                          onPointerLeave={() => setHoverKey((h) => (h === key ? null : h))}
                          onPointerDown={(e) => startElementDrag(e, i)}
                        />
                      </g>
                    );
                  })}
                  {/* 选中框 + 8 向缩放手柄 */}
                  {adjustedEls.map((el, i) => {
                    if (chartElemKey(el, i) !== selectedKey) return null;
                    const b = elementBounds(el);
                    // 屏幕恒定尺寸：viewBox 单位 = 屏幕像素 / pxPerUnit（pxPerUnit 已含 CSS transform 缩放），
                    // 手柄约 10px、描边约 1.5px，任意缩放级别下都清晰可见
                    const hs = Math.max(8, 10 / pxPerUnit);
                    const sw = Math.max(1, 1.5 / pxPerUnit);
                    const dash = `${Math.max(3, 6 / pxPerUnit)} ${Math.max(2, 4 / pxPerUnit)}`;
                    const handles = [
                      { dir: "nw", x: b.x, y: b.y },
                      { dir: "n", x: b.x + b.width / 2 - hs / 2, y: b.y },
                      { dir: "ne", x: b.x + b.width - hs, y: b.y },
                      { dir: "e", x: b.x + b.width - hs, y: b.y + b.height / 2 - hs / 2 },
                      { dir: "se", x: b.x + b.width - hs, y: b.y + b.height - hs },
                      { dir: "s", x: b.x + b.width / 2 - hs / 2, y: b.y + b.height - hs },
                      { dir: "sw", x: b.x, y: b.y + b.height - hs },
                      { dir: "w", x: b.x, y: b.y + b.height / 2 - hs / 2 },
                    ];
                    return (
                      <g key={`sel-${i}`} data-testid="chart-selection">
                        <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="#3b82f6" strokeWidth={sw} strokeDasharray={dash} pointerEvents="none" />
                        {handles.map((h) => (
                          <rect
                            key={h.dir}
                            data-testid={`chart-handle-${h.dir}`}
                            x={h.x}
                            y={h.y}
                            width={hs}
                            height={hs}
                            fill="#ffffff"
                            stroke="#3b82f6"
                            strokeWidth={sw}
                            className="cursor-nwse-resize"
                            onPointerDown={(e) => startResize(e, i, h.dir)}
                          />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="flex h-56 items-center justify-center text-xs text-gray-400">填写数据后实时预览</div>
              )}
              {/* 拖拽/缩放提示 */}
              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-white/70 px-1 text-[9px] text-gray-400">点击元素拖动调整 · 滚轮缩放</span>
            </div>
            {/* 字号控件：选中文字元素（有 fontSize 字段）时显示，−/+ 调整写入元素微调偏移 */}
            {(() => {
              if (!selectedKey) return null;
              const idx = adjustedEls.findIndex((e, i) => chartElemKey(e, i) === selectedKey);
              if (idx < 0) return null;
              const sel = adjustedEls[idx];
              if (!("fontSize" in sel) || sel.fontSize === undefined) return null;
              const base = "fontSize" in previewEls![idx] ? (previewEls![idx] as { fontSize?: number }).fontSize ?? 12 : 12;
              const size = sel.fontSize;
              const bump = (delta: number) => {
                const next = Math.max(6, Math.min(72, size + delta));
                setAdjust((prev) => ({ ...prev, [selectedKey]: { ...(prev[selectedKey] ?? {}), fontSize: next - base } }));
              };
              return (
                <div data-testid="chart-font-control" className="flex items-center gap-2 rounded-lg border border-blue-200/70 bg-blue-50/60 px-2 py-1 text-xs text-gray-600">
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400">字号</span>
                  <button aria-label="减小字号" onClick={() => bump(-1)} className="lift grid h-6 w-6 shrink-0 place-items-center rounded bg-white text-sm text-gray-700 shadow-sm hover:bg-blue-100">−</button>
                  <span className="w-9 text-center font-medium text-blue-700" data-testid="chart-font-size">{size}</span>
                  <button aria-label="增大字号" onClick={() => bump(1)} className="lift grid h-6 w-6 shrink-0 place-items-center rounded bg-white text-sm text-gray-700 shadow-sm hover:bg-blue-100">＋</button>
                  <span className="ml-auto truncate text-[10px] text-gray-400">拖动元素调整位置/大小</span>
                </div>
              );
            })()}
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
