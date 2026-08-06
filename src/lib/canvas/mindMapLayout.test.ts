import { describe, it, expect } from "vitest";
import { layoutMindMap } from "./mindMapLayout";
import type { CanvasElement } from "./types";

describe("mindMapLayout", () => {
  it("3 个一级分支均分 360°（12 点起），中心主题居中偏上", () => {
    const els = layoutMindMap({ topic: "深度学习", branches: [{ keyword: "A" }, { keyword: "B" }, { keyword: "C" }] });
    const topic = els.find((e) => e.type === "logic" && e.text === "深度学习")!;
    expect(topic.x + topic.width / 2).toBeCloseTo(800);
    expect(topic.y + topic.height / 2).toBeCloseTo(470);
    const nodes = els.filter((e) => e.type === "logic" && e.text !== "深度学习");
    expect(nodes).toHaveLength(3);
    const centers = nodes.map((n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 }));
    // 分支 0 正上方（-90°），分支 1/2 依次顺时针 120°
    expect(centers[0].y).toBeLessThan(470);
    expect(centers[1].x).toBeGreaterThan(800);
    expect(centers[1].y).toBeGreaterThan(470);
    expect(centers[2].x).toBeLessThan(800);
    // 三条分支曲线
    expect(els.filter((e) => e.type === "curve")).toHaveLength(3);
  });

  it("子分支逐层外扩、绕父角度均分，颜色继承父分支", () => {
    const els = layoutMindMap({
      topic: "T",
      branches: [{ keyword: "A", children: [{ keyword: "A1" }, { keyword: "A2" }] }],
    });
    const a = els.find((e) => e.type === "logic" && e.text === "A")!;
    const a1 = els.find((e) => e.type === "text" && e.text === "A1")!;
    const a2 = els.find((e) => e.type === "text" && e.text === "A2")!;
    // 子分支在父节点更远处（半径 +190）
    const dist = (e: CanvasElement) => Math.hypot(e.x + e.width / 2 - 800, e.y + e.height / 2 - 470);
    expect(dist(a1)).toBeGreaterThan(dist(a));
    expect(dist(a2)).toBeGreaterThan(dist(a));
    // 两个子分支在父角度两侧（一个更靠上/逆时针，一个更靠下/顺时针）
    const ang = (e: CanvasElement) => Math.atan2(e.y + e.height / 2 - 470, e.x + e.width / 2 - 800);
    expect(ang(a1)).toBeLessThan(ang(a));
    expect(ang(a2)).toBeGreaterThan(ang(a));
    // 颜色继承：A1/A2 与 A 同填充色
    expect(a1.fill).toBe(a.fill);
    expect(a2.fill).toBe(a.fill);
    // 曲线：主题→A、A→A1、A→A2 共 3 条
    expect(els.filter((e) => e.type === "curve")).toHaveLength(3);
  });

  it("每个一级分支颜色不同（5 色调色板循环）", () => {
    const els = layoutMindMap({ topic: "T", branches: [{ keyword: "a" }, { keyword: "b" }, { keyword: "c" }] });
    const fills = els.filter((e) => e.type === "logic" && e.text !== "T").map((e) => e.fill);
    expect(new Set(fills).size).toBe(3);
  });

  it("整体超出画布时自动缩放回画布内", () => {
    // 4 个一级分支（-90°/0°/90°/180° 均分）× 3 层深（半径 300/490/680）：
    // 90° 方向第三层节点底边 ≈ 470+680+9 ≈ 1159 > 1000，内容高 ≈ 1378 > 960，触发缩放（scale ≈ 0.697）
    const els = layoutMindMap({
      topic: "T",
      branches: [
        { keyword: "a", children: [{ keyword: "a1", children: [{ keyword: "a2" }] }] },
        { keyword: "b", children: [{ keyword: "b1", children: [{ keyword: "b2" }] }] },
        { keyword: "c", children: [{ keyword: "c1", children: [{ keyword: "c2" }] }] },
        { keyword: "d", children: [{ keyword: "d1", children: [{ keyword: "d2" }] }] },
      ],
    });
    for (const e of els) {
      if (e.type === "logic" || e.type === "text") {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.x + e.width).toBeLessThanOrEqual(1600);
        expect(e.y + e.height).toBeLessThanOrEqual(1000);
      }
    }
  });
});
