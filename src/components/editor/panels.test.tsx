import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Toolbar from "./Toolbar";
import PropertyPanel from "./PropertyPanel";
import ChatPanel from "./ChatPanel";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { layoutChart, type ChartSpec } from "@/lib/canvas/chartLayout";
import type { ArrowElement } from "@/lib/canvas/types";

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
  it("选中箭头显示边框/整体卡片：边框色/粗细/边框透明度/样式与整体透明度/旋转/阴影，无内部卡片", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    // 箭头无填充渲染：不显示"内部"卡片（填充色对箭头无意义）
    expect(screen.queryByText("内部")).toBeNull();
    const card = [...document.querySelectorAll("section")].find((s) => s.querySelector("h3")?.textContent === "边框")!;
    // 色板按钮不计入编辑顺序（色板固定在卡片首部）
    const seq = [...card.querySelectorAll("[aria-label],button")]
      .map((el) => el.getAttribute("aria-label") ?? el.textContent!.trim())
      .filter((l) => !l.startsWith("预设色"));
    // 编辑顺序：边框色 → 线宽 → 边框透明度 → 箭头样式（无/单/双）
    expect(seq).toEqual(["边框色", "线宽", "线宽 数值", "边框透明度", "边框透明度 数值", "无箭头", "单箭头", "双箭头"]);
  });

  it("箭头卡片交互：样式切换 head，粗细/边框透明度/旋转/颜色写入元素", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText("双箭头"));
    expect((useCanvasStore.getState().doc.elements[0] as ArrowElement).head).toBe("double");
    fireEvent.click(screen.getByText("无箭头"));
    expect((useCanvasStore.getState().doc.elements[0] as ArrowElement).head).toBe("none");
    fireEvent.change(screen.getByLabelText("粗细"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("边框透明度"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("旋转"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("边框色"), { target: { value: "#ff0000" } });
    const e = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(e.strokeWidth).toBe(6);
    expect(e.strokeOpacity).toBe(0.5);
    expect(e.rotation).toBe(45);
    expect(e.stroke).toBe("#ff0000");
  });

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

  it("色板网格直接选色：点击色块设置箭头颜色与填充色，自定义 hex 同步写入", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByLabelText("预设色 #3b82f6"));
    expect((useCanvasStore.getState().doc.elements[0] as ArrowElement).stroke).toBe("#3b82f6");
    const r = makeElement("rect", 0, 0, 100, 60, { id: "r1" });
    act(() => useCanvasStore.getState().addElement(r));
    act(() => useCanvasStore.getState().setSelection([r.id]));
    // rect 有内部+边框两个色板：取第一个（内部卡）设置填充色
    fireEvent.click(screen.getAllByLabelText("预设色 #f0fff0")[0]);
    expect(useCanvasStore.getState().doc.elements.find((e) => e.id === "r1")!.fill).toBe("#f0fff0");
    // 自定义 hex 输入：非法值不写入，失焦回退显示当前色
    const fill = screen.getByLabelText("填充色") as HTMLInputElement;
    fireEvent.change(fill, { target: { value: "#1234" } });
    expect(useCanvasStore.getState().doc.elements.find((e) => e.id === "r1")!.fill).toBe("#f0fff0");
    fireEvent.blur(fill);
    expect(fill.value).toBe("#f0fff0");
  });

  it("选中文字显示文本编辑框", () => {
    const t = makeElement("text", 0, 0, 60, 20, { text: "你好" });
    useCanvasStore.getState().addElement(t);
    useCanvasStore.getState().setSelection([t.id]);
    render(<PropertyPanel />);
    const box = screen.getByLabelText("文字内容") as HTMLInputElement;
    expect(box.value).toBe("你好");
  });

  it("面板多卡：逻辑节点显示内部/边框/整体 + 标题/正文块", () => {
    const l = makeElement("logic", 0, 0, 150, 60, { text: "特征提取", body: "卷积\n池化" });
    useCanvasStore.getState().addElement(l);
    useCanvasStore.getState().setSelection([l.id]);
    render(<PropertyPanel />);
    const titles = [...document.querySelectorAll("section h3")].map((h) => h.textContent);
    expect(titles).toContain("内部");
    expect(titles).toContain("边框");
    expect(titles).toContain("整体");
    expect(screen.getAllByText("标题").length).toBeGreaterThan(0); // section 标题 + 字段标签
    expect(screen.getByText("正文")).toBeInTheDocument();
    const title = screen.getByLabelText("标题") as HTMLInputElement;
    expect(title.value).toBe("特征提取");
    const body = screen.getByLabelText("正文") as HTMLTextAreaElement;
    expect(body.value).toBe("卷积\n池化");
    // 改标题/正文直接写回元素
    fireEvent.change(title, { target: { value: "分类器" } });
    fireEvent.change(body, { target: { value: "新正文" } });
    const el = useCanvasStore.getState().doc.elements[0];
    if (el.type === "logic") {
      expect(el.text).toBe("分类器");
      expect(el.body).toBe("新正文");
    }
  });

  it("形状类元素显示内部/边框/整体卡，无标题/正文", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    const titles = [...document.querySelectorAll("section h3")].map((h) => h.textContent);
    expect(titles).toContain("内部");
    expect(titles).toContain("边框");
    expect(titles).toContain("整体");
    expect(screen.queryByText("正文")).toBeNull();
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
    // rect 有内部+边框两个色板：取第一个（内部卡）设置填充色
    fireEvent.click(screen.getAllByLabelText("预设色 #f0fff0")[0]);
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
    // 类型徽章（层级列表条目里的类型标签不算）
    const badges = screen.getAllByText("逻辑节点").filter((el) => el.classList.contains("bg-blue-100/70"));
    expect(badges).toHaveLength(1);
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

  it("层级卡片：按 zIndex 降序列出全部元素（首个顶层、末个底层），点击条目选中元素", () => {
    const a = makeElement("rect", 0, 0, 100, 60, { id: "a1" });
    const b = makeElement("ellipse", 10, 10, 50, 50, { id: "b1" });
    useCanvasStore.getState().addElements([a, b]); // a z=1、b z=2（b 更顶）
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    const items = screen.getAllByTestId("layer-item");
    expect(items.map((i) => i.getAttribute("data-element-id"))).toEqual([b.id, a.id]);
    expect(items[0].textContent).toContain("顶层");
    expect(items[1].textContent).toContain("底层");
    // 当前选中的条目高亮
    expect(items[1].classList.contains("bg-blue-50")).toBe(true);
    // 点击条目切换选中
    fireEvent.click(items[0]);
    expect(useCanvasStore.getState().selection).toEqual([b.id]);
  });

  it("层级卡片拖拽排序：把底层条目拖到顶层条目上 → 该元素变最顶层，一步撤销恢复", () => {
    const a = makeElement("rect", 0, 0, 100, 60, { id: "a1" });
    const b = makeElement("ellipse", 10, 10, 50, 50, { id: "b1" });
    useCanvasStore.getState().addElements([a, b]);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    const items = screen.getAllByTestId("layer-item"); // [b(顶层), a(底层)]
    const dt = { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" };
    fireEvent.dragStart(items[1], { dataTransfer: dt });
    fireEvent.dragOver(items[0], { dataTransfer: dt });
    fireEvent.drop(items[0], { dataTransfer: dt });
    const byId = new Map(useCanvasStore.getState().doc.elements.map((e) => [e.id, e.zIndex]));
    expect(byId.get(a.id)).toBe(2); // a 被提到最顶
    expect(byId.get(b.id)).toBe(1);
    // 一步撤销恢复原层级
    useCanvasStore.getState().undo();
    const back = new Map(useCanvasStore.getState().doc.elements.map((e) => [e.id, e.zIndex]));
    expect(back.get(a.id)).toBe(1);
    expect(back.get(b.id)).toBe(2);
  });

  it("整体卡阴影：点添加按钮生成默认阴影，滑块调整模糊/偏移/浓淡，移除恢复", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<PropertyPanel />);
    expect(screen.queryByText("移除阴影")).toBeNull();
    fireEvent.click(screen.getByText("＋ 添加阴影"));
    expect(useCanvasStore.getState().doc.elements[0].shadow).toEqual({ color: "#000000", blur: 8, dx: 2, dy: 2, opacity: 0.25 });
    fireEvent.change(screen.getByLabelText("阴影模糊"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("阴影水平偏移"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("阴影浓度"), { target: { value: "0.5" } });
    const sh = useCanvasStore.getState().doc.elements[0].shadow!;
    expect(sh.blur).toBe(12);
    expect(sh.dx).toBe(5);
    expect(sh.opacity).toBe(0.5);
    fireEvent.click(screen.getByText("移除阴影"));
    expect(useCanvasStore.getState().doc.elements[0].shadow).toBeUndefined();
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
