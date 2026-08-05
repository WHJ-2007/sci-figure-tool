import { describe, it, expect } from "vitest";
import { layoutGraph, type GraphNode } from "./graphLayout";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./geometry";

const n = (id: string, width = 120, height = 60): GraphNode => ({ id, width, height });

describe("graphLayout（dagre 分层布局）", () => {
  it("TB 流水线：三节点同列、纵向等距、返回左上角坐标", () => {
    const pos = layoutGraph([n("a"), n("b"), n("c")], [{ from: "a", to: "b" }, { from: "b", to: "c" }], "TB", 60);
    expect(pos.get("a")!.x).toBeCloseTo(pos.get("b")!.x, 5);
    expect(pos.get("b")!.x).toBeCloseTo(pos.get("c")!.x, 5);
    expect(pos.get("b")!.y - pos.get("a")!.y).toBeCloseTo(60 + 60, 5); // ranksep 60 + 节点高 60
    expect(pos.get("c")!.y - pos.get("b")!.y).toBeCloseTo(60 + 60, 5);
    // 返回的是左上角：中心坐标 - 宽高一半
    expect(pos.get("a")!.x).toBeGreaterThanOrEqual(0);
  });

  it("LR 流水线：三节点同行、横向等距", () => {
    const pos = layoutGraph([n("a"), n("b"), n("c")], [{ from: "a", to: "b" }, { from: "b", to: "c" }], "LR", 60);
    expect(pos.get("a")!.y).toBeCloseTo(pos.get("b")!.y, 5);
    expect(pos.get("b")!.y).toBeCloseTo(pos.get("c")!.y, 5);
    expect(pos.get("b")!.x - pos.get("a")!.x).toBeCloseTo(60 + 120, 5); // nodesep 60 + 节点宽 120
  });

  it("分支节点处于同一层（a→b 与 a→c 中 b、c 对齐）", () => {
    const pos = layoutGraph(
      [n("a"), n("b"), n("c")],
      [{ from: "a", to: "b" }, { from: "a", to: "c" }],
      "TB",
      40
    );
    expect(pos.get("b")!.y).toBeCloseTo(pos.get("c")!.y, 5);
  });

  it("互不重叠：任意两个节点 bbox 不交叉", () => {
    const nodes = [n("a", 100, 50), n("b", 160, 70), n("c", 120, 60), n("d", 140, 55), n("e", 110, 65)];
    const edges = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "e" },
      { from: "d", to: "e" },
    ];
    const pos = layoutGraph(nodes, edges, "TB", 40);
    const rects = nodes.map((n) => ({ x: pos.get(n.id)!.x, y: pos.get(n.id)!.y, w: n.width, h: n.height }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("布局整体超出画布时缩放进画布（fit，保留最小 20 边距）", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => n(`n${i}`, 240, 80));
    const edges = nodes.slice(1).map((node, i) => ({ from: `n${i}`, to: node.id }));
    const pos = layoutGraph(nodes, edges, "TB", 40);
    for (const node of nodes) {
      const p = pos.get(node.id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + node.width).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(p.y + node.height).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it("孤点（无边节点）也能布局", () => {
    const pos = layoutGraph([n("a"), n("b")], [], "TB", 60);
    expect(pos.size).toBe(2);
    expect(pos.get("a")!.x).toBeGreaterThanOrEqual(0);
  });
});
