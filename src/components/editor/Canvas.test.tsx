import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("Canvas", () => {
  it("渲染文档内元素", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 10, 20, 100, 60, { fill: "#123456" }));
    useCanvasStore.getState().addElement(makeElement("text", 0, 0, 50, 20, { text: "Encoder" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector("rect")).toBeTruthy();
    expect(screen.getByText("Encoder")).toBeInTheDocument();
  });

  it("渲染选中框", () => {
    const a = makeElement("rect", 10, 20, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector('[data-testid="selection-rect"]')).toBeTruthy();
  });
});
