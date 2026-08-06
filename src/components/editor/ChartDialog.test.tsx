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
});
