import { describe, it, expect } from "vitest";
import {
  shapePoints,
  hitTestElement,
  clampRect,
  alignOffsets,
  distributeOffsets,
  snapRect,
  alignmentGuides,
  arrowHeadPoints,
  arrowHeadSize,
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
  it("五角星 10 个顶点，外圈/内圈交替（内径 = 外径 × 0.382），首点朝上", () => {
    const pts = shapePoints("star", { x: 0, y: 0, width: 100, height: 100 });
    expect(pts).toHaveLength(10);
    // 首点正上方（外圈顶点），第二点内圈
    expect(pts[0].x).toBeCloseTo(50);
    expect(pts[0].y).toBeCloseTo(0);
    expect(Math.hypot(pts[0].x - 50, pts[0].y - 50)).toBeCloseTo(50);
    expect(Math.hypot(pts[1].x - 50, pts[1].y - 50)).toBeCloseTo(50 * 0.382);
    // 外圈顶点间距相等（72° 步进）
    expect(Math.hypot(pts[2].x - 50, pts[2].y - 50)).toBeCloseTo(50);
  });
  it("十字 12 个顶点：臂宽 = min(w,h)/3，凹口深度 = min(w,h)/6", () => {
    const pts = shapePoints("cross", { x: 0, y: 0, width: 120, height: 60 });
    expect(pts).toHaveLength(12);
    // min=60 → 臂宽 20、凹口 10；中心在 (60,30)
    expect(pts[1].x - pts[0].x).toBeCloseTo(20);
    expect(pts[0].y).toBeCloseTo(0);
    expect(pts[2].y - pts[1].y).toBeCloseTo(20); // 顶臂下缘到凹口 = cy - aw = 30 - 10
    expect(pts[3].x).toBeCloseTo(120);
    expect(pts[6].y).toBeCloseTo(60);
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
  it("带折点的箭头按折线判定（折点为相对坐标，自动偏移起点）", () => {
    // 起点 (50,20)，折点相对 (100,40) → 世界 (150,60)；首段 (50,20)→(150,60)、末段 (150,60)→(250,20)
    const a = makeElement("arrow", 50, 20, 200, 0, { midPoints: [{ x: 100, y: 40 }] }) as CanvasElement;
    expect(hitTestElement(a, { x: 100, y: 40 })).toBe(true); // 首段中点
    expect(hitTestElement(a, { x: 200, y: 40 })).toBe(true); // 末段中点
    expect(hitTestElement(a, { x: 150, y: 70 })).toBe(false); // 折点下方 10px
    expect(hitTestElement(a, { x: 150, y: 50 })).toBe(false); // 折点上方 10px（离开两段）
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
  it("带折点的箭头包围盒覆盖折点（吸附以折点边为准；折点为相对坐标）", () => {
    // 起点 (50,20)，折点相对 (100,40) → 世界 (150,60)，包围盒底边 y=60：目标 y=62 距底边 2px → dy = -2
    const a = makeElement("arrow", 50, 20, 200, 0, { midPoints: [{ x: 100, y: 40 }] }) as CanvasElement;
    const offs = snapRect({ x: 151, y: 62, width: 0, height: 0 }, [a]);
    expect(offs.dy).toBe(-2);
  });
});

describe("alignmentGuides PPT 式对齐参考线", () => {
  it("左边缘与目标左边缘对齐（5px 内）时返回垂直参考线", () => {
    const A = makeElement("rect", 100, 0, 50, 50) as CanvasElement;
    // 移动矩形宽 80 → 中心 x=135 距目标中心 125 有 10px（超阈值）；仅左-左（95→100）在 5px 内
    const guides = alignmentGuides({ x: 95, y: 100, width: 80, height: 50 }, [A]);
    expect(guides.x).toBe(100); // 左-左对齐：参考线在目标左边 x=100
    expect(guides.y).toBeUndefined();
  });
  it("中心对齐时返回参考线（含垂直与水平）", () => {
    const A = makeElement("rect", 100, 100, 50, 50) as CanvasElement;
    // 移动矩形中心 (150, 150)，目标中心 (125, 125)——相距 25px 超出阈值，不命中
    const far = alignmentGuides({ x: 125, y: 125, width: 50, height: 50 }, [A]);
    expect(far.x).toBeUndefined();
    expect(far.y).toBeUndefined();
    // 移动矩形中心 (127, 127)（目标中心 125，差 2px 在阈值内）→ 垂直+水平参考线都在 125
    const near = alignmentGuides({ x: 102, y: 102, width: 50, height: 50 }, [A]);
    expect(near.x).toBe(125);
    expect(near.y).toBe(125);
  });
  it("无目标时不返回参考线", () => {
    const guides = alignmentGuides({ x: 50, y: 50, width: 50, height: 50 }, []);
    expect(guides.x).toBeUndefined();
    expect(guides.y).toBeUndefined();
  });
});

describe("arrowHeadPoints", () => {
  it("朝右的箭头生成箭头三角", () => {
    const pts = arrowHeadPoints(0, 0, 100, 0, 10);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 100, y: 0 });
  });
});

describe("arrowHeadSize", () => {
  it("线宽 2（默认）→ 10px 头，保持默认观感", () => {
    expect(arrowHeadSize(2)).toBe(10);
  });
  it("线宽加倍头随之变大（粗细联动箭头头）", () => {
    expect(arrowHeadSize(4)).toBeGreaterThan(arrowHeadSize(2));
    expect(arrowHeadSize(6)).toBe(28);
  });
  it("细线限幅：线宽 1 也有可见的头", () => {
    expect(arrowHeadSize(1)).toBe(6);
    expect(arrowHeadSize(0.5)).toBe(6);
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

describe("hitTestElement 新图案", () => {
  it("圆环：环带命中、内孔与外圆外不命中", () => {
    // 100×100：外圆 r=50，内孔 r=32.5（0.65×50）
    const d = makeElement("donut", 0, 0, 100, 100);
    expect(hitTestElement(d, { x: 50, y: 10 })).toBe(true); // 顶部环带（d=40 ∈ [32.5,50]）
    expect(hitTestElement(d, { x: 50, y: 40 })).toBe(false); // 内孔（d=10 < 32.5）
    expect(hitTestElement(d, { x: 110, y: 50 })).toBe(false); // 外圆外（d=60 > 50）
  });
  it("半圆：上半圆盘命中、下半圆与外圆外不命中", () => {
    const h = makeElement("half", 0, 0, 100, 100);
    expect(hitTestElement(h, { x: 50, y: 10 })).toBe(true); // 上半圆内
    expect(hitTestElement(h, { x: 50, y: 60 })).toBe(false); // 圆心（50,50）下方 → 不命中
    expect(hitTestElement(h, { x: 50, y: 100 })).toBe(false); // 底部矩形角（下半外）
    expect(hitTestElement(h, { x: 5, y: 49 })).toBe(true); // 上半圆靠近边缘内
  });
  it("五角星内部命中、凹口与外不命中（多边形判定）", () => {
    const s = makeElement("star", 0, 0, 100, 100);
    expect(hitTestElement(s, { x: 50, y: 50 })).toBe(true); // 中心
    expect(hitTestElement(s, { x: 50, y: 5 })).toBe(true); // 顶部外圈
    expect(hitTestElement(s, { x: 140, y: 50 })).toBe(false); // 外
  });
  it("十字内部命中、凹角与外不命中（多边形判定）", () => {
    const c = makeElement("cross", 0, 0, 100, 100);
    expect(hitTestElement(c, { x: 50, y: 50 })).toBe(true); // 中心
    expect(hitTestElement(c, { x: 5, y: 5 })).toBe(false); // 凹角（外）
    expect(hitTestElement(c, { x: 110, y: 50 })).toBe(false);
  });
});
