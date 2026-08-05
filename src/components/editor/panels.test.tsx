import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import PropertyPanel from "./PropertyPanel";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("Toolbar", () => {
  it("点击工具切换 tool", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("矩形"));
    expect(useCanvasStore.getState().tool).toBe("rect");
    fireEvent.click(screen.getByTitle("选择"));
    expect(useCanvasStore.getState().tool).toBe("select");
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
});
