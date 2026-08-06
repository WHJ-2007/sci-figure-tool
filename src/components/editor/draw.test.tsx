import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import type { ArrowElement } from "@/lib/canvas/types";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0 });
  // 模拟真实拖拽的多次 pointermove（捕获每帧累积点这类 bug），最后必须移动到终点
  for (let i = 1; i <= 2; i++) {
    fireEvent.pointerMove(el, {
      clientX: from.x + ((to.x - from.x) * i) / 3,
      clientY: from.y + ((to.y - from.y) * i) / 3,
      buttons: 1,
    });
  }
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, buttons: 1 });
  fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y });
}

describe("绘制工具", () => {
  it("矩形工具拖拽创建矩形", () => {
    useCanvasStore.getState().setTool("rect");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 250, y: 180 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("rect");
    expect(e.x).toBe(100);
    expect(e.y).toBe(100);
    expect(e.width).toBe(150);
    expect(e.height).toBe(80);
  });

  it("文字工具点击创建文字并进入编辑", () => {
    useCanvasStore.getState().setTool("text");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("text");
    expect(document.querySelector('[data-testid="text-editor"]')).toBeTruthy();
  });

  it("双击文字进入编辑、回车提交", () => {
    useCanvasStore.getState().addElement(makeElement("text", 50, 50, 60, 20, { text: "旧文字" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.doubleClick(svg, { clientX: 80, clientY: 60 });
    const input = document.querySelector('[data-testid="text-editor"]')!;
    fireEvent.change(input, { target: { value: "新文字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const e = useCanvasStore.getState().doc.elements[0];
    expect((e as any).text).toBe("新文字");
  });

  it("polyline 拖拽只保留起点与终点两点", () => {
    useCanvasStore.getState().setTool("polyline");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 250, y: 180 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("polyline");
    if (e.type === "polyline") {
      expect(e.points.length).toBe(2);
      expect(e.points[0]).toEqual({ x: 100, y: 100 });
      expect(e.points[1]).toEqual({ x: 250, y: 180 });
    }
  });

  it("过小形状丢弃", () => {
    useCanvasStore.getState().setTool("rect");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 102, y: 103 });
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
  });

  it("draw-line 单点点击不创建", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
  });

  it("箭头两点制：点击起点再点击终点创建箭头并选中", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    // 起点已定：移动指针出现预览线（半透明）
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 180 });
    expect(document.querySelector('line[opacity="0.6"]')).toBeTruthy();
    fireEvent.pointerDown(svg, { clientX: 250, clientY: 180, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 250, clientY: 180 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("arrow");
    expect(e.x).toBe(100);
    expect(e.y).toBe(100);
    expect(e.width).toBe(150);
    expect(e.height).toBe(80);
    expect(useCanvasStore.getState().selection).toEqual([e.id]);
  });

  it("箭头两点制：两次点击同一位置视为取消，不创建", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
    expect(document.querySelector('line[opacity="0.6"]')).toBeNull();
  });

  it("箭头两点制：右键取消待定起点，预览消失", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 150 });
    expect(document.querySelector('line[opacity="0.6"]')).toBeTruthy();
    fireEvent.pointerDown(svg, { clientX: 200, clientY: 150, button: 2 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 150, button: 2 });
    expect(document.querySelector('line[opacity="0.6"]')).toBeNull();
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
  });

  it("箭头两点制：切走箭头工具自动取消待定起点", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 150 });
    expect(document.querySelector('line[opacity="0.6"]')).toBeTruthy();
    act(() => useCanvasStore.getState().setTool("select"));
    expect(document.querySelector('line[opacity="0.6"]')).toBeNull();
  });

  it("Escape 取消不写回", () => {
    useCanvasStore.getState().addElement(makeElement("text", 50, 50, 60, 20, { text: "旧文字" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.doubleClick(svg, { clientX: 80, clientY: 60 });
    const input = document.querySelector('[data-testid="text-editor"]')!;
    fireEvent.change(input, { target: { value: "新文字" } });
    // 同一次 act 中依次派发 Escape 与 blur：blur 时编辑器尚未卸载，模拟浏览器里
    // Escape 关闭后紧跟的失焦写回（修复前 blur 会把输入内容写回，断言先失败）
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    const e = useCanvasStore.getState().doc.elements[0];
    if (e.type === "text") expect(e.text).toBe("旧文字");
    expect(useCanvasStore.getState().editingText).toBeNull();
  });

  it("文字工具双击只创建一个", () => {
    useCanvasStore.getState().setTool("text");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(useCanvasStore.getState().doc.elements.length).toBe(1);
  });

  it("arrow 负向拖拽选中框正常", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 200, y: 200 }, { x: 100, y: 100 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("arrow");
    expect(e.width).toBe(-100);
    expect(e.height).toBe(-100);
    const rect = document.querySelector('svg rect[stroke="#2563eb"]')!;
    expect(rect.getAttribute("width")).toBe("100");
  });
});

describe("箭头中间折点", () => {
  // 右键线段 → 弹出折点菜单 → 点"新建尖锐折点"
  function rightClickThenAddSharp(svg: Element, x: number, y: number) {
    fireEvent.contextMenu(svg, { clientX: x, clientY: y });
    fireEvent.click(document.querySelector('[data-testid="add-sharp-midpoint"]')!);
  }

  it("选中箭头右键线段弹菜单，新建尖锐折点并弯折渲染为折线", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 100 }); // 线段中点
    expect(document.querySelector('[data-testid="arrow-context-menu"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="add-sharp-midpoint"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="add-smooth-midpoint"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-testid="add-sharp-midpoint"]')!);
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    // 折点为相对坐标：世界 (200,100) - 起点 (100,100) = (100,0)
    expect(e.midPoints).toEqual([{ x: 100, y: 0 }]);
    // 尖锐折点渲染为 polyline 折线（不再是 line）
    expect(document.querySelector("polyline")).toBeTruthy();
  });

  it("新建平滑折点：smooth 标志 + Catmull-Rom path 渲染（无 polyline）", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 100 });
    fireEvent.click(document.querySelector('[data-testid="add-smooth-midpoint"]')!);
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toEqual([{ x: 100, y: 0, smooth: true }]);
    // 平滑折点渲染为 path（主路径 + 透明命中层），不再有 polyline
    expect(document.querySelector("polyline")).toBeNull();
    expect(document.querySelector('path[stroke-linejoin="round"]')).toBeTruthy();
  });

  it("右键线段任意处插入，折点投影到线上（弯折箭头）", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    rightClickThenAddSharp(svg, 250, 106); // 靠近终点一侧、偏离线 6px（容差 14px 内）
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toHaveLength(1);
    expect(e.midPoints![0]).toEqual({ x: 150, y: 0 }); // 投影世界 (250,100) - 起点 (100,100)
  });

  it("右键已有折点弹删除菜单，删除该折点（其余保留）", () => {
    // 折点为相对坐标：世界 (200,100)/(250,80) 对应相对 (100,0)/(150,-20)
    useCanvasStore.getState().addElement(
      makeElement("arrow", 100, 100, 200, 0, { id: "a1", midPoints: [{ x: 100, y: 0 }, { x: 150, y: -20 }] })
    );
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 100 });
    expect(document.querySelector('[data-testid="delete-midpoint"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-testid="delete-midpoint"]')!);
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toEqual([{ x: 150, y: -20 }]);
  });

  it("右键未选中的箭头：选中该箭头并弹出折点菜单（右键不进 rubber）", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().addElement(makeElement("rect", 400, 400, 60, 40, { id: "r1" }));
    useCanvasStore.getState().setSelection(["r1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    // 完整右键手势：pointerdown(button 2) → pointerup → contextmenu → 菜单
    fireEvent.pointerDown(svg, { clientX: 200, clientY: 100, button: 2 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 100, button: 2 });
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 100 });
    expect(document.querySelector('[data-testid="arrow-context-menu"]')).toBeTruthy();
    expect(useCanvasStore.getState().selection).toEqual(["a1"]);
    // 折点相对起点：世界 (200,100) → (100,0)
    fireEvent.click(document.querySelector('[data-testid="add-sharp-midpoint"]')!);
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toEqual([{ x: 100, y: 0 }]);
  });

  it("右键远离箭头不弹折点菜单", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.contextMenu(svg, { clientX: 600, clientY: 500 });
    expect(document.querySelector('[data-testid="arrow-context-menu"]')).toBeNull();
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toBeUndefined();
  });

  it("右键插入折点后选择保留（不进多选框选不清空）", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().addElement(makeElement("rect", 400, 400, 60, 40, { id: "r1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    // 完整右键手势：pointerdown(button 2) → pointerup → contextmenu → 菜单
    fireEvent.pointerDown(svg, { clientX: 200, clientY: 100, button: 2 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 100, button: 2 });
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 100 });
    fireEvent.click(document.querySelector('[data-testid="add-sharp-midpoint"]')!);
    const e = useCanvasStore.getState().doc.elements.find((x) => x.id === "a1") as ArrowElement;
    expect(e.midPoints).toHaveLength(1);
    expect(useCanvasStore.getState().selection).toEqual(["a1"]);
  });

  it("折点增删一步撤销：插入后 undo 恢复直箭头", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { id: "a1" }));
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    rightClickThenAddSharp(svg, 200, 100);
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.midPoints).toHaveLength(1);
    act(() => useCanvasStore.getState().undo());
    const back = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(back.midPoints).toBeUndefined();
  });

  it("整体移动带折点的箭头：折点相对坐标不变，世界位置自动跟随", () => {
    useCanvasStore.getState().addElement(
      makeElement("arrow", 100, 100, 200, 0, { id: "a1", midPoints: [{ x: 200, y: 60 }] })
    );
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    // jsdom 不做命中测试：事件必须派发到元素节点（closest 才能找到 data-element-id）
    const el = document.querySelector('[data-element-id="a1"]')!;
    fireEvent.pointerDown(el, { clientX: 150, clientY: 100, button: 0 });
    // 拖动事件走 window 级监听（真实指针移出元素后由 window 接收）
    fireEvent.pointerMove(window, { clientX: 170, clientY: 120, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 190, clientY: 140, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 190, clientY: 140 });
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.x).toBe(140); // 100 + 40
    expect(e.y).toBe(140); // 100 + 40
    // 相对坐标原样保留：折点世界位置 = 新起点 (140,140) + (200,60) = (340,200)
    expect(e.midPoints).toEqual([{ x: 200, y: 60 }]);
  });

  it("单独拖动折点：改变折点相对位置（绝对世界位置换算回相对起点）", () => {
    useCanvasStore.getState().addElement(
      makeElement("arrow", 100, 100, 200, 0, { id: "a1", midPoints: [{ x: 200, y: 60 }] })
    );
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const mp = document.querySelector('[data-midpoint="0"]')!;
    // 折点手柄拖动走 window 级监听：起止都在中点，move 事件挂 window
    fireEvent.pointerDown(mp, { clientX: 200, clientY: 60, button: 0 });
    fireEvent.pointerMove(window, { clientX: 230, clientY: 90, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 230, clientY: 90 });
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    // 拖动到世界 (230,90)，相对起点 (100,100) = (130,-10)
    expect(e.midPoints).toEqual([{ x: 130, y: -10 }]);
    // 端点不动：起点终点仍为 (100,100)→(300,100)
    expect(e.x).toBe(100);
    expect(e.width).toBe(200);
  });

  it("箭头选中显示端点手柄 start/end，无图案式缩放/旋转手柄", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const start = document.querySelector('[data-handle="start"]');
    const end = document.querySelector('[data-handle="end"]');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    // 端点手柄为实心蓝色圆形（与逻辑节点锚点一致，白色画布上醒目可见，提示可自由拖动）
    expect(start!.getAttribute("fill")).toBe("#2563eb");
    expect(end!.getAttribute("fill")).toBe("#2563eb");
    for (const h of ["e", "w", "n", "s", "nw", "ne", "sw", "se", "rotate"]) {
      expect(document.querySelector(`[data-handle="${h}"]`)).toBeNull();
    }
  });

  it("拖动终点手柄：起点固定，终点跟随指针（长度/方向改变）", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const end = document.querySelector('[data-handle="end"]')!;
    fireEvent.pointerDown(end, { clientX: 300, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 350, clientY: 120, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 350, clientY: 120 });
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.x).toBe(100);
    expect(e.y).toBe(100);
    expect(e.width).toBe(250); // 350 - 100
    expect(e.height).toBe(20); // 120 - 100
  });

  it("拖动起点手柄：终点固定，起点跟随（width/height 相应调整，允许负值翻转）", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const start = document.querySelector('[data-handle="start"]')!;
    fireEvent.pointerDown(start, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 130, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 130 });
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.x).toBe(80);
    expect(e.y).toBe(130);
    expect(e.width).toBe(220); // 300 - 80
    expect(e.height).toBe(-30); // 100 - 130（起点越过终点 → 负高翻转）
  });
});
