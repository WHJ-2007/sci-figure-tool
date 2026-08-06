"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { layoutChart, type ChartSpec, type ChartDatum } from "@/lib/canvas/chartLayout";
import { useCanvasStore } from "@/lib/canvas/store";
import { newId } from "@/lib/canvas/elements";
import type { CanvasElement } from "@/lib/canvas/types";

interface Row { label: string; value: string; series: string }

const CHART_TYPES = [
  ["bar", "柱状图"],
  ["line", "折线图"],
  ["pie", "饼图"],
  ["scatter", "散点图"],
] as const;

function emptyRows(): Row[] {
  return [
    { label: "", value: "", series: "" },
    { label: "", value: "", series: "" },
    { label: "", value: "", series: "" },
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
  const [title, setTitle] = useState("");
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  const [rows, setRows] = useState<Row[]>(emptyRows());
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.type);
      setTitle(initial.title ?? "");
      setXLabel(initial.xLabel ?? "");
      setYLabel(initial.yLabel ?? "");
      setRows(initial.data.map((d) => ({ label: d.label, value: String(d.value), series: d.series ?? "" })));
    } else {
      setType("bar");
      setTitle("");
      setXLabel("");
      setYLabel("");
      setRows(emptyRows());
    }
    setErr("");
  }, [open, initial]);

  if (!open) return null;

  const setRow = (i: number, k: keyof Row, v: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };

  const submit = () => {
    const data: ChartDatum[] = [];
    for (const r of rows) {
      const label = r.label.trim();
      if (!label) { setErr("分类标签不能为空"); return; }
      if (r.value.trim() === "") { setErr("数值不能为空"); return; }
      const v = Number(r.value);
      if (!Number.isFinite(v)) { setErr("数值必须是数字"); return; }
      if (v < 0) { setErr("数值必须是非负数字"); return; }
      data.push({ label, value: v, series: r.series.trim() || undefined });
    }
    if (data.length < 3) { setErr("至少 3 行数据"); return; }
    if (data.length > 12) { setErr("最多 12 行数据"); return; }
    if (data.reduce((s, d) => s + d.value, 0) <= 0) { setErr("数据总和必须大于 0"); return; }
    const spec: ChartSpec = {
      type,
      data,
      title: title.trim() || undefined,
      xLabel: xLabel.trim() || undefined,
      yLabel: yLabel.trim() || undefined,
    };
    const id = chartId ?? newId();
    const elements: CanvasElement[] = layoutChart(spec).map((e) => ({ ...e, chartId: id }));
    const replaceIds = chartId
      ? useCanvasStore.getState().doc.elements.filter((e) => e.chartId === chartId).map((e) => e.id)
      : [];
    useCanvasStore.getState().applyChartEdit(id, spec, elements, replaceIds);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="chart-dialog" onClick={onClose}>
      <div className="glass-panel max-h-[85vh] w-[30rem] max-w-[92vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-gray-800">{chartId ? "编辑图表数据" : "生成图表"}</h3>
        <div className="mb-3 flex gap-1.5">
          {CHART_TYPES.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setType(v)}
              aria-pressed={type === v}
              className={`lift rounded-full px-3 py-1 text-xs ${
                type === v ? "bg-blue-600 text-white shadow-sm" : "border border-white/60 bg-white/70 text-gray-500 hover:bg-white/90"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-500">
            标题
            <input value={title} aria-label="图表标题" onChange={(e) => setTitle(e.target.value)} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/70 px-1.5 text-gray-700 outline-none focus:border-blue-300" />
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-500">
            X 轴
            <input value={xLabel} aria-label="X 轴名" onChange={(e) => setXLabel(e.target.value)} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/70 px-1.5 text-gray-700 outline-none focus:border-blue-300" />
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-500">
            Y 轴
            <input value={yLabel} aria-label="Y 轴名" onChange={(e) => setYLabel(e.target.value)} className="h-7 flex-1 rounded-lg border border-white/60 bg-white/70 px-1.5 text-gray-700 outline-none focus:border-blue-300" />
          </label>
        </div>
        <div className="mb-1 flex gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          <span className="w-24">标签</span>
          <span className="w-20">数值</span>
          <span className="w-20">系列（可选）</span>
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`标签 ${i + 1}`} value={r.label} onChange={(e) => setRow(i, "label", e.target.value)} className="h-7 w-24 rounded-lg border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300" />
              <input aria-label={`数值 ${i + 1}`} value={r.value} onChange={(e) => setRow(i, "value", e.target.value)} className="h-7 w-20 rounded-lg border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300" />
              <input aria-label={`系列 ${i + 1}`} value={r.series} onChange={(e) => setRow(i, "series", e.target.value)} className="h-7 w-20 rounded-lg border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300" />
              <button
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                disabled={rows.length <= 3}
                className="lift rounded-lg px-1.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-30"
                title="删除行"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => setRows((rs) => [...rs, { label: "", value: "", series: "" }])} disabled={rows.length >= 12} className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-xs text-gray-600 disabled:opacity-40">+ 添加行</button>
          <span className="text-xs text-gray-400">3~12 行</span>
        </div>
        {err && <div className="mt-2 rounded-lg border border-red-200/60 bg-red-100/40 px-2 py-1 text-xs text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600">取消</button>
          <button onClick={submit} className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white">{chartId ? "保存修改" : "生成图表"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
