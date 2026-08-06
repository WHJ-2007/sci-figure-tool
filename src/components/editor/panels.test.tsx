import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import PropertyPanel from "./PropertyPanel";
import ChatPanel from "./ChatPanel";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { layoutChart, type ChartSpec } from "@/lib/canvas/chartLayout";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("Toolbar", () => {
  it("点击工具切换 tool", () => {
    render(<Toolbar />);
    // 选择已并入默认交互（无按钮）：初始工具即 select
    expect(useCanvasStore.getState().tool).toBe("select");
    // 图案气泡：先开图形按钮再点子工具
    fireEvent.click(screen.getByTitle("图形"));
    fireEvent.click(screen.getByTitle("矩形"));
    expect(useCanvasStore.getState().tool).toBe("rect");
  });

  it("撤销重做按钮", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("撤销"));
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    fireEvent.click(screen.getByTitle("重做"));
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });
});

describe("悬浮动效", () => {
  it("属性面板所有操作按钮带 lift 类", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    const btns = screen.getAllByRole("button");
    expect(btns.length).toBeGreaterThanOrEqual(2);
    for (const b of btns) expect(b.classList.contains("lift")).toBe(true);
  });

  it("聊天面板收起/发送按钮带 lift 类", () => {
    const { getAllByRole } = render(<ChatPanel />);
    for (const b of getAllByRole("button")) expect(b.classList.contains("lift")).toBe(true);
  });
});

describe("PropertyPanel", () => {
  it("选中矩形显示填充色并可修改", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    const fill = screen.getByLabelText("填充色") as HTMLInputElement;
    expect(fill.value).toBe("#ffffff");
    fireEvent.change(fill, { target: { value: "#ff0000" } });
    expect(useCanvasStore.getState().doc.elements[0].fill).toBe("#ff0000");
  });

  it("选中文字显示文本编辑框", () => {
    const t = makeElement("text", 0, 0, 60, 20, { text: "你好" });
    useCanvasStore.getState().addElement(t);
    useCanvasStore.getState().setSelection([t.id]);
    render(<PropertyPanel />);
    const box = screen.getByLabelText("文字内容") as HTMLInputElement;
    expect(box.value).toBe("你好");
  });

  it("无选择时显示提示", () => {
    render(<PropertyPanel />);
    expect(screen.getByText(/未选中元素/)).toBeInTheDocument();
  });

  it("对齐水平居中：参考元素不动、其余移到同一 centerX，一步撤销恢复", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("rect", 200, 100, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().setSelection([a.id, b.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText("水平居中"));
    const [ea, eb] = useCanvasStore.getState().doc.elements;
    // alignOffsets：doc 顺序首个为参考，仅其余元素偏移到参考的 centerX（a 中心 50）
    expect(ea.x).toBe(0);
    expect(ea.y).toBe(0);
    expect(eb.x).toBe(0); // b 中心 250 → 50，偏移 -200
    expect(eb.y).toBe(100); // 纵向不受影响
    useCanvasStore.getState().undo();
    const [ua, ub] = useCanvasStore.getState().doc.elements;
    expect(ua.x).toBe(0);
    expect(ub.x).toBe(200);
    expect(ub.y).toBe(100);
  });

  it("横分布：首尾不动，中间等距均匀化", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("rect", 200, 0, 100, 60);
    const c = makeElement("rect", 400, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().addElement(c);
    useCanvasStore.getState().setSelection([a.id, b.id, c.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText("横分布"));
    const [ea, eb, ec] = useCanvasStore.getState().doc.elements;
    // distributeOffsets：span 400 - 总宽 300 = 100，除以 2 个间距 → 间隙 50
    expect(ea.x).toBe(0);
    expect(eb.x).toBe(150);
    expect(ec.x).toBe(300);
  });

  it("预设科研色板点击设置填充色", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByLabelText("预设色 #f0fff0"));
    expect(useCanvasStore.getState().doc.elements[0].fill).toBe("#f0fff0");
  });

  it("线宽滑块与数值输入双向同步", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.change(screen.getByLabelText("线宽"), { target: { value: "5" } });
    expect(useCanvasStore.getState().doc.elements[0].strokeWidth).toBe(5);
  });

  it("类型徽章显示中文类型名", () => {
    const a = makeElement("logic", 0, 0, 100, 60, { text: "多头注意力" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    expect(screen.getByText("逻辑节点")).toBeInTheDocument();
  });

  it("水平镜像按钮切换 flipH", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByTitle("水平镜像"));
    expect(useCanvasStore.getState().doc.elements[0].flipH).toBe(true);
    fireEvent.click(screen.getByTitle("水平镜像"));
    expect(useCanvasStore.getState().doc.elements[0].flipH).toBe(false);
  });

  it("垂直镜像按钮切换 flipV", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByTitle("垂直镜像"));
    expect(useCanvasStore.getState().doc.elements[0].flipV).toBe(true);
  });

  it("选择整个图表：选中图表全部元素（可统一移动/删除）", () => {
    const spec: ChartSpec = { type: "bar", title: "销售", data: [{ label: "Q1", value: 10 }, { label: "Q2", value: 20 }, { label: "Q3", value: 15 }] };
    const els = layoutChart(spec).map((e) => ({ ...e, chartId: "c1" }));
    useCanvasStore.getState().applyChartEdit("c1", spec, els, []);
    const ids = useCanvasStore.getState().doc.elements.map((e) => e.id);
    expect(ids.length).toBeGreaterThan(1);
    useCanvasStore.getState().setSelection([ids[0]]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText("选择整个图表"));
    expect(useCanvasStore.getState().selection).toEqual(ids);
  });

  it("操作卡删除按钮删除选中元素", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText("删除"));
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });
});
