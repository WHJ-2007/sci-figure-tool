import { describe, it, expect } from "vitest";
import {
  shapePoints,
  hitTestElement,
  clampRect,
  alignOffsets,
  distributeOffsets,
  snapRect,
  arrowHeadPoints,
} from "./geometry";
import { makeElement } from "./elements";
import type { CanvasElement } from "./types";

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
});

describe("arrowHeadPoints", () => {
  it("朝右的箭头生成箭头三角", () => {
    const pts = arrowHeadPoints(0, 0, 100, 0, 10);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 100, y: 0 });
  });
});
