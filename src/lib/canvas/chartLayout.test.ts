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
});
