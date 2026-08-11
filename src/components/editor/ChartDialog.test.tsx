import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartDialog from "./ChartDialog";
import { useCanvasStore } from "@/lib/canvas/store";
import { layoutChart } from "@/lib/canvas/chartLayout";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("ChartDialog", () => {
  it("手动生成图表：填 3 行数据点生成，元素带 chartId 且登记 charts", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("折线图"));
    // 默认 2 行：先添加第 3 行再填 3 个数据点
    fireEvent.click(screen.getByText("+ 添加行"));
    const labels = screen.getAllByLabelText(/标签 \d+/);
    const values = screen.getAllByLabelText(/数值 \d+/);
    fireEvent.change(labels[0], { target: { value: "Q1" } });
    fireEvent.change(values[0], { target: { value: "10" } });
    fireEvent.change(labels[1], { target: { value: "Q2" } });
    fireEvent.change(values[1], { target: { value: "20" } });
    fireEvent.change(labels[2], { target: { value: "Q3" } });
    fireEvent.change(values[2], { target: { value: "15" } });
    // 标题 h3 与提交按钮同为「生成图表」，用 role 精确命中按钮
    fireEvent.click(screen.getByRole("button", { name: "生成图表" }));
    const st = useCanvasStore.getState();
    expect(st.doc.elements.length).toBeGreaterThan(0);
    const chartIds = new Set(st.doc.elements.map((e) => e.chartId).filter(Boolean));
    expect(chartIds.size).toBe(1);
    expect(Object.values(st.doc.charts ?? {})[0].type).toBe("line");
  });

  it("校验错误：空标签提示", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "生成图表" }));
    expect(screen.getByText(/标签不能为空/)).toBeInTheDocument();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("编辑模式：预填数据，保存后替换旧元素", () => {
    const s = useCanvasStore.getState();
    const spec = { type: "bar" as const, data: [{ label: "A", value: 1 }, { label: "B", value: 2 }, { label: "C", value: 3 }] };
    const els = layoutChart(spec).map((e) => ({ ...e, chartId: "c1" }));
    s.applyChartEdit("c1", spec, els, []);
    // s 是 applyChartEdit 前的状态快照（doc 为旧引用），重新读取当前 store
    const oldCount = useCanvasStore.getState().doc.elements.length;
    render(<ChartDialog open={true} chartId="c1" initial={spec} onClose={() => {}} />);
    fireEvent.click(screen.getByText("保存修改"));
    const st = useCanvasStore.getState();
    expect(st.doc.elements.length).toBe(oldCount); // 替换而非追加
  });

  it("类型选择：4 种图表均以图标卡片呈现，点击切换选中态", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    for (const label of ["柱状图", "折线图", "饼图", "散点图"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn.querySelector("svg")).not.toBeNull(); // 每个类型都带迷你图表图标
    }
    fireEvent.click(screen.getByRole("button", { name: "饼图" }));
    expect(screen.getByRole("button", { name: "饼图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "柱状图" })).toHaveAttribute("aria-pressed", "false");
  });

  it("饼图隐藏无意义字段：无 X/Y 轴输入、无分组列", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    // 默认柱状图显示坐标轴与分组
    expect(screen.getByLabelText("X 轴名")).toBeInTheDocument();
    expect(screen.getByLabelText("Y 轴名")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/分组 \d+/).length).toBe(2);
    // 切到饼图：轴与分组全部隐藏，数据行只剩标签/数值
    fireEvent.click(screen.getByRole("button", { name: "饼图" }));
    expect(screen.queryByLabelText("X 轴名")).toBeNull();
    expect(screen.queryByLabelText("Y 轴名")).toBeNull();
    expect(screen.queryByLabelText(/分组 \d+/)).toBeNull();
    expect(screen.getAllByLabelText(/标签 \d+/).length).toBe(2);
    expect(screen.getAllByLabelText(/数值 \d+/).length).toBe(2);
  });

  it("类型切换保留已填数据：柱状图填完切走再切回，数据不丢", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    const labels = screen.getAllByLabelText(/标签 \d+/);
    const values = screen.getAllByLabelText(/数值 \d+/);
    fireEvent.change(labels[0], { target: { value: "Q1" } });
    fireEvent.change(values[0], { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "饼图" }));
    fireEvent.click(screen.getByRole("button", { name: "柱状图" }));
    expect(screen.getByLabelText("标签 1")).toHaveValue("Q1");
    expect(screen.getByLabelText("数值 1")).toHaveValue("42");
  });

  it("饼图生成时丢弃分组与坐标轴名：spec 不含 xLabel/yLabel/series", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    // 柱状图下先填好分组，再切饼图生成——分组不应进入 spec
    fireEvent.change(screen.getByLabelText("分组 1"), { target: { value: "S1" } });
    fireEvent.change(screen.getByLabelText("X 轴名"), { target: { value: "季度" } });
    fireEvent.click(screen.getByRole("button", { name: "饼图" }));
    // 默认 2 行：先添加第 3 行再填 3 个数据点
    fireEvent.click(screen.getByText("+ 添加行"));
    const labels = screen.getAllByLabelText(/标签 \d+/);
    const values = screen.getAllByLabelText(/数值 \d+/);
    fireEvent.change(labels[0], { target: { value: "A" } });
    fireEvent.change(values[0], { target: { value: "50" } });
    fireEvent.change(labels[1], { target: { value: "B" } });
    fireEvent.change(values[1], { target: { value: "30" } });
    fireEvent.change(labels[2], { target: { value: "C" } });
    fireEvent.change(values[2], { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "生成图表" }));
    const st = useCanvasStore.getState();
    const spec = Object.values(st.doc.charts ?? {})[0];
    expect(spec.type).toBe("pie");
    expect(spec.xLabel).toBeUndefined();
    expect(spec.yLabel).toBeUndefined();
    expect(spec.data.every((d) => d.series === undefined)).toBe(true);
  });

  it("数据行可删到最少 1 条：删 2 行后单行生成成功，1 行时删除按钮禁用", () => {
    render(<ChartDialog open={true} onClose={() => {}} />);
    // 初始 2 行：删到 1 行
    const delBtns = screen.getAllByTitle("删除行");
    expect(delBtns.length).toBe(2);
    fireEvent.click(delBtns[1]);
    expect(screen.getAllByLabelText(/标签 \d+/).length).toBe(1);
    expect(screen.getAllByTitle("删除行")[0]).toBeDisabled();
    // 单行也能生成
    fireEvent.change(screen.getByLabelText("标签 1"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("数值 1"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "生成图表" }));
    const st = useCanvasStore.getState();
    const spec = Object.values(st.doc.charts ?? {})[0];
    expect(spec.data).toHaveLength(1);
    expect(spec.data[0]).toMatchObject({ label: "A", value: 100 });
  });
});
