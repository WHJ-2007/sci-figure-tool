import { describe, it, expect } from "vitest";
import {
  shapePoints,
  hitTestElement,
  clampRect,
  alignOffsets,
  distributeOffsets,
  snapRect,
  arrowHeadPoints,
  arrowPathD,
  logicAnchors,
  nearestAnchor,
  anchorToward,
} from "./geometry";
import { makeElement } from "./elements";
import type { CanvasElement, LogicElement } from "./types";

const rect = makeElement("rect", 10, 10, 100, 60) as CanvasElement;

describe("shapePoints", () => {
  it("三角形 3 个顶点", () => {
    const pts = shapePoints("triangle", { x: 0, y: 0, width: 100, height: 60 });
    expect(pts).toHaveLength(3);
  });
  it("六边形 6 个顶点且关于中心对称", () => {
    const pts = shapePoints("hexagon", { x: 0, y: 0, width: 100, height: 60 });
    expect(pts).toHaveLength(6);
    const cx = (pts[0].x + pts[3].x) / 2;
    expect(cx).toBeCloseTo(50);
  });
});

describe("hitTestElement", () => {
  it("点在矩形内命中", () => {
    expect(hitTestElement(rect, { x: 50, y: 30 })).toBe(true);
  });
  it("点在矩形外不命中", () => {
    expect(hitTestElement(rect, { x: 200, y: 30 })).toBe(false);
  });
  it("矩形边框附近容差内命中", () => {
    expect(hitTestElement(rect, { x: 10, y: 10 })).toBe(true);
    expect(hitTestElement(rect, { x: 12, y: 8 })).toBe(true);
    expect(hitTestElement(rect, { x: 12, y: 4 })).toBe(false);
  });
  it("椭圆按椭圆方程判定", () => {
    const e = makeElement("ellipse", 0, 0, 100, 60) as CanvasElement;
    expect(hitTestElement(e, { x: 50, y: 30 })).toBe(true);
    expect(hitTestElement(e, { x: 0, y: 30 })).toBe(true); // 左右顶点
    expect(hitTestElement(e, { x: 100, y: 30 })).toBe(true);
    expect(hitTestElement(e, { x: 50, y: 0 })).toBe(true);
    expect(hitTestElement(e, { x: 50, y: 62 })).toBe(false);
  });
  it("箭头按线段距离判定", () => {
    const a = makeElement("arrow", 0, 0, 100, 0) as CanvasElement;
    expect(hitTestElement(a, { x: 50, y: 3 })).toBe(true);
    expect(hitTestElement(a, { x: 50, y: 10 })).toBe(false);
  });
  it("带折点的箭头按折线判定：中间段附近命中、远离不命中", () => {
    const a = makeElement("arrow", 0, 0, 200, 0, { midPoints: [{ x: 100, y: 40 }] }) as CanvasElement;
    expect(hitTestElement(a, { x: 50, y: 20 })).toBe(true); // 首段 (0,0)→(100,40) 上
    expect(hitTestElement(a, { x: 150, y: 20 })).toBe(true); // 末段 (100,40)→(200,0) 上
    expect(hitTestElement(a, { x: 100, y: 50 })).toBe(false); // 折点下方 10px
    expect(hitTestElement(a, { x: 100, y: 30 })).toBe(false); // 折点上方 10px（离开两段）
  });
});

describe("hitTestElement 多边形", () => {
  const tri = makeElement("triangle", 0, 0, 100, 60) as CanvasElement;
  it("三角形内部命中", () => {
    expect(hitTestElement(tri, { x: 50, y: 30 })).toBe(true); // 底部中点，必在内部
    expect(hitTestElement(tri, { x: 50, y: 55 })).toBe(true);
  });
  it("三角形外不命中（上外角、左右外侧）", () => {
    expect(hitTestElement(tri, { x: 50, y: 0 })).toBe(false); // 顶角上方
    expect(hitTestElement(tri, { x: 0, y: 0 })).toBe(false);
    expect(hitTestElement(tri, { x: 100, y: 0 })).toBe(false);
  });
  it("菱形中心命中", () => {
    const dia = makeElement("diamond", 0, 0, 100, 60) as CanvasElement;
    expect(hitTestElement(dia, { x: 50, y: 30 })).toBe(true);
  });
  it("六边形中心命中", () => {
    const hex = makeElement("hexagon", 0, 0, 100, 60) as CanvasElement;
    expect(hitTestElement(hex, { x: 50, y: 30 })).toBe(true);
    expect(hitTestElement(hex, { x: 50, y: -4 })).toBe(false); // 上方外侧，必不命中
  });
});

describe("clampRect", () => {
  it("越界矩形被钳制到画布内", () => {
    expect(clampRect({ x: -50, y: -30, width: 100, height: 60 })).toEqual({ x: 0, y: 0, width: 100, height: 60 });
    expect(clampRect({ x: 1550, y: 990, width: 100, height: 60 })).toEqual({ x: 1500, y: 940, width: 100, height: 60 });
  });
});

describe("alignOffsets", () => {
  const A = makeElement("rect", 0, 0, 100, 60) as CanvasElement;
  const B = makeElement("rect", 300, 200, 50, 40) as CanvasElement;
  it("左对齐把 B 挪到 A 的左边", () => {
    const offs = alignOffsets([A.id, B.id], [A, B], "left");
    expect(offs.get(B.id)).toEqual({ dx: -300, dy: 0 });
  });
  it("水平居中按中线对齐", () => {
    const offs = alignOffsets([A.id, B.id], [A, B], "centerX");
    // A 中线 x=50，B 中线 x=325 → dx = 50 - 325 = -275
    expect(offs.get(B.id)).toEqual({ dx: -275, dy: 0 });
  });
});

describe("distributeOffsets", () => {
  it("水平均匀分布", () => {
    const E1 = makeElement("rect", 0, 0, 40, 40) as CanvasElement;
    const E2 = makeElement("rect", 200, 0, 40, 40) as CanvasElement;
    const E3 = makeElement("rect", 400, 0, 40, 40) as CanvasElement;
    const ids = [E1.id, E2.id, E3.id];
    const offs = distributeOffsets(ids, [E1, E2, E3], "horizontal");
    // 跨度 400 - 总宽 120 = 280，均分 2 段 → 间隙 140：
    // E1 原地 x=0 → E2 x=180（dx -20）→ E3 x=360（dx -40）
    expect(offs.get(E1.id)).toEqual({ dx: 0, dy: 0 });
    expect(offs.get(E2.id)).toEqual({ dx: -20, dy: 0 });
    expect(offs.get(E3.id)).toEqual({ dx: -40, dy: 0 });
  });
});

describe("snapRect", () => {
  it("6px 内吸附到其他元素边缘", () => {
    const A = makeElement("rect", 100, 0, 50, 50) as CanvasElement;
    const moving = makeElement("rect", 5, 100, 50, 50) as CanvasElement;
    // moving 左边 x=5 距 A 左边 x=100 有 95px——不吸附。改为贴得近的：
    // 阈值比较为严格小于（|d| < best），恰好 6px 不吸附，取 5px 距离的用例：
    const offs = snapRect({ ...moving, x: 95 }, [A]);
    expect(offs.dx).toBe(5); // 95 → 100
  });
  it("无目标时不吸附", () => {
    const offs = snapRect({ x: 50, y: 50, width: 50, height: 50 }, []);
    expect(offs.dx).toBe(0);
    expect(offs.dy).toBe(0);
  });
  it("排除自身：不因自身旧位置而失效，仍吸附到邻元素", () => {
    const self = makeElement("rect", 95, 100, 50, 50) as CanvasElement;
    const neighbor = makeElement("rect", 100, 0, 50, 50) as CanvasElement;
    // 自身旧位置 x=95（若不过滤自身，d=0 会把 best 置 0、压制一切吸附）；
    // 邻元素左边 x=100 距自身左边 5px，在阈值 6px 内 → 应吸附 dx=5
    const offs = snapRect(self, [self, neighbor], 6, self.id);
    expect(offs.dx).toBe(5);
    expect(offs.dy).toBe(0);
    // 无邻元素（仅自身）时不吸附——保留原测试意图
    const alone = snapRect(self, [self], 6);
    expect(alone).toEqual({ dx: 0, dy: 0 });
  });
  it("带折点的箭头包围盒覆盖折点（吸附以折点边为准）", () => {
    const a = makeElement("arrow", 0, 0, 200, 0, { midPoints: [{ x: 100, y: 40 }] }) as CanvasElement;
    // 折点 (100,40) 是包围盒底边：目标点 y=42 距底边 2px → dy = -2（若包围盒不含折点则无吸附）
    const offs = snapRect({ x: 101, y: 42, width: 0, height: 0 }, [a]);
    expect(offs.dy).toBe(-2);
  });
});

describe("arrowHeadPoints", () => {
  it("朝右的箭头生成箭头三角", () => {
    const pts = arrowHeadPoints(0, 0, 100, 0, 10);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 100, y: 0 });
  });
});

describe("arrowPathD（折点箭头路径）", () => {
  it("全尖锐折点输出折线", () => {
    expect(arrowPathD([{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 0 }])).toBe("M 0 0 L 100 40 L 200 0");
  });
  it("平滑折点输出 Catmull-Rom 三次贝塞尔（端点切线反射延拓）", () => {
    // 单折点 (100,40) 平滑：首段 prev 反射 = (0,0)-(100,40) 延拓 = (-100,-40)，末段 next 反射 = (300,-40)
    // c1 = a + (b-prev)/6 = (33.33, 13.33)，c2 = b - (next-a)/6 = (66.67, 40)
    // 第二段 c1 = (133.33, 40)，c2 = (166.67, 13.33)
    const d = arrowPathD([{ x: 0, y: 0 }, { x: 100, y: 40, smooth: true }, { x: 200, y: 0 }]);
    // 浮点输出（如 33.333333333333336）：前缀截断匹配
    expect(d).toMatch(/^M 0 0 C 33\.33\d* 13\.33\d* 66\.6\d* 40 100 40 C 133\.33\d* 40 166\.6\d* 13\.33\d* 200 0$/);
  });
  it("smooth 标志任一端为 true 即走曲线", () => {
    const d = arrowPathD([{ x: 0, y: 0, smooth: true }, { x: 100, y: 40 }, { x: 200, y: 0 }]);
    expect(d).toMatch(/^M 0 0 C /);
  });
});

describe("逻辑节点锚点", () => {
  it("logicAnchors 返回上下左右 4 个锚点", () => {
    const l = makeElement("logic", 100, 200, 120, 60, { text: "处理" }) as LogicElement;
    const anchors = logicAnchors(l);
    expect(anchors.map((a) => a.side).sort()).toEqual(["bottom", "left", "right", "top"]);
    const top = anchors.find((a) => a.side === "top")!;
    const right = anchors.find((a) => a.side === "right")!;
    expect(top).toMatchObject({ x: 160, y: 200 });
    expect(right).toMatchObject({ x: 220, y: 230 });
    // 锚点 id 含元素 id 与方向
    expect(top.id).toBe(`${l.id}:top`);
  });

  it("旋转后锚点绕中心旋转", () => {
    const l = makeElement("logic", 100, 200, 120, 60, { text: "A", rotation: 90 }) as LogicElement;
    const anchors = logicAnchors(l);
    const right = anchors.find((a) => a.side === "right")!;
    // 旋转 90°：右锚点 (220,230) 绕中心 (160,230) 旋转 → (160, 290)
    expect(right.x).toBeCloseTo(160, 5);
    expect(right.y).toBeCloseTo(290, 5);
  });

  it("非逻辑元素没有锚点", () => {
    const r = makeElement("rect", 0, 0, 100, 60);
    expect(logicAnchors(r)).toHaveLength(0);
  });

  it("nearestAnchor 阈值内返回最近锚点，阈值外返回 null", () => {
    const l = makeElement("logic", 100, 200, 120, 60, { text: "A" });
    // (170, 200) 距 top 锚点 (160,200) 10px < 12 → 吸附
    const a1 = nearestAnchor([l], { x: 170, y: 200 });
    expect(a1?.side).toBe("top");
    // (150, 210) 距 top (160,200) 14px > 12 → 不吸附
    expect(nearestAnchor([l], { x: 150, y: 210 })).toBeNull();
    // 非逻辑元素不参与吸附
    const r = makeElement("rect", 0, 0, 100, 60);
    expect(nearestAnchor([r], { x: 50, y: 0 })).toBeNull();
  });

  it("anchorToward 返回朝向 p 的锚点（无阈值，自动连接用），非逻辑元素返回 null", () => {
    const l = makeElement("logic", 100, 200, 120, 60, { text: "A" });
    expect(anchorToward(l, { x: 500, y: 230 })?.side).toBe("right");
    expect(anchorToward(l, { x: 160, y: 50 })?.side).toBe("top");
    expect(anchorToward(l, { x: 50, y: 230 })?.side).toBe("left");
    // 旋转 90° 后右锚点转到下方 (160, 290)，朝向 (160, 400) 的锚点是 right（旋转后语义方向）
    const rot = makeElement("logic", 100, 200, 120, 60, { text: "A", rotation: 90 });
    expect(anchorToward(rot, { x: 160, y: 500 })?.side).toBe("right");
    const r = makeElement("rect", 0, 0, 100, 60);
    expect(anchorToward(r, { x: 10, y: 10 })).toBeNull();
  });
});
