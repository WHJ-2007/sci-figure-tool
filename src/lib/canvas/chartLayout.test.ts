import { describe, it, expect } from "vitest";
import { niceScale, layoutChart } from "./chartLayout";

describe("niceScale", () => {
  it("123 → 步长 25 / 上限 125（目标 5 格取整）", () => {
    expect(niceScale(123)).toEqual({ step: 25, max: 125 });
  });
  it("250 → 步长 50 / 上限 250", () => {
    expect(niceScale(250)).toEqual({ step: 50, max: 250 });
  });
  it("1 → 步长 0.2 / 上限 1", () => {
    expect(niceScale(1)).toEqual({ step: 0.2, max: 1 });
  });
});

describe("layoutChart", () => {
  it("柱状图：两条坐标轴 + 每项一根柱 + 数值标签 + 标题", () => {
    const els = layoutChart({ type: "bar", title: "季度销售额", data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 80 }] });
    expect(els.filter((e) => e.type === "arrow")).toHaveLength(2);
    expect(els.filter((e) => e.type === "rect")).toHaveLength(2); // 两根柱
    expect(els.filter((e) => e.type === "text").some((t) => t.text === "季度销售额")).toBe(true);
    expect(els.filter((e) => e.type === "text").some((t) => t.text === "120")).toBe(true);
  });

  it("折线图：polyline 不带箭头，数据点椭圆，多系列图例", () => {
    const els = layoutChart({
      type: "line",
      data: [
        { label: "A", value: 1, series: "x" },
        { label: "A", value: 2, series: "y" },
        { label: "B", value: 3, series: "x" },
        { label: "B", value: 4, series: "y" },
      ],
    });
    const lines = els.filter((e) => e.type === "polyline");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.arrow === false)).toBe(true);
    expect(els.filter((e) => e.type === "ellipse")).toHaveLength(4); // 数据点
    expect(els.filter((e) => e.type === "rect")).toHaveLength(2);    // 图例色块
  });

  it("饼图：扇形数 = 数据项数，百分比标签，右侧图例", () => {
    const els = layoutChart({ type: "pie", data: [{ label: "A", value: 3 }, { label: "B", value: 1 }] });
    expect(els.filter((e) => e.type === "sector")).toHaveLength(2);
    expect(els.filter((e) => e.type === "text").some((t) => t.text === "75%")).toBe(true);
  });

  it("散点图：每个数据点一个椭圆，无折线", () => {
    const els = layoutChart({ type: "scatter", data: [{ label: "a", value: 5 }, { label: "b", value: 9 }] });
    expect(els.filter((e) => e.type === "ellipse")).toHaveLength(2);
    expect(els.filter((e) => e.type === "polyline")).toHaveLength(0);
  });

  it("layoutChart 传 chartId：饼图扇形 bind slice、百分比标签 pie-label、图例 pie-legend（带 index）", () => {
    const els = layoutChart({ type: "pie", title: "T", data: [{ label: "A", value: 3 }, { label: "B", value: 1 }] }, "c1");
    const slices = els.filter((e) => e.type === "sector");
    expect(slices).toHaveLength(2);
    expect(slices[0].chartId).toBe("c1");
    expect(slices[0].bind).toEqual({ chartId: "c1", role: "slice", index: 0 });
    expect(slices[1].bind).toEqual({ chartId: "c1", role: "slice", index: 1 });
    const labels = els.filter((e) => e.type === "text" && e.bind?.role === "pie-label");
    expect(labels.map((l) => l.bind)).toEqual([
      { chartId: "c1", role: "pie-label", index: 0 },
      { chartId: "c1", role: "pie-label", index: 1 },
    ]);
    // 图例 = 色块 rect + 名称 text 各 2 个
    const legends = els.filter((e) => e.bind?.role === "pie-legend");
    expect(legends).toHaveLength(4);
  });

  it("layoutChart 传 chartId：柱体 bind bar、数值标签 bar-label、标题 bind title（非数据项无 index）", () => {
    const els = layoutChart({ type: "bar", title: "销售", data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 80 }] }, "c2");
    const bars = els.filter((e) => e.type === "rect" && e.bind?.role === "bar");
    expect(bars.map((b) => b.bind)).toEqual([
      { chartId: "c2", role: "bar", index: 0 },
      { chartId: "c2", role: "bar", index: 1 },
    ]);
    const title = els.find((e) => e.type === "text" && e.text === "销售");
    expect(title?.bind).toEqual({ chartId: "c2", role: "title" });
    const val = els.find((e) => e.type === "text" && e.bind?.role === "bar-label" && e.text === "120");
    expect(val?.bind).toEqual({ chartId: "c2", role: "bar-label", index: 0 });
    // 坐标轴/刻度也有 bind（整图重排按 bind.chartId 替换，全部元素都要打标）
    expect(els.every((e) => e.chartId === "c2" && e.bind)).toBe(true);
  });

  it("layoutChart 不传 chartId：无 bind 无 chartId（旧数据兼容）", () => {
    const els = layoutChart({ type: "pie", data: [{ label: "A", value: 3 }] });
    expect(els.every((e) => !e.bind && !e.chartId)).toBe(true);
  });
});
