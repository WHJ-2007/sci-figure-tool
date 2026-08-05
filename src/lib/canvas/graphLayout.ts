import dagre from "dagre";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./geometry";

export interface GraphNode {
  id: string;
  width: number;
  height: number;
}
export interface GraphEdge {
  from: string;
  to: string;
}

// 语义与布局分离：AI 只声明节点+边，坐标交给 dagre 分层布局（Sugiyama 体系，Mermaid/React Flow/d2 同款引擎）。
// 返回每个节点左上角坐标；布局整体超出画布时按比例缩放进画布（节点自身尺寸不变，保底 20px 边距）。
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "TB" | "LR" = "TB",
  gap = 60
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: gap, ranksep: gap, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) {
    if (nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxW = 0, maxH = 0;
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p.x - n.width / 2 < minX) minX = p.x - n.width / 2;
    if (p.y - n.height / 2 < minY) minY = p.y - n.height / 2;
    if (p.x + n.width / 2 > maxX) maxX = p.x + n.width / 2;
    if (p.y + n.height / 2 > maxY) maxY = p.y + n.height / 2;
    if (n.width > maxW) maxW = n.width;
    if (n.height > maxH) maxH = n.height;
  }
  const bboxW = Math.max(maxX - minX, 1);
  const bboxH = Math.max(maxY - minY, 1);
  // 位置整体缩放、节点自身尺寸不变：缩放后最右/底部 = 边距 + bbox×scale + 最大节点尺寸×(1-scale)，
  // 预算时把节点尺寸从 bbox 中扣除（位置间距压缩才是缩放收益）
  const scaleX = bboxW > maxW ? (CANVAS_WIDTH - 40 - maxW) / (bboxW - maxW) : Infinity;
  const scaleY = bboxH > maxH ? (CANVAS_HEIGHT - 40 - maxH) / (bboxH - maxH) : Infinity;
  const scale = Math.max(0.5, Math.min(1, scaleX, scaleY));
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, {
      x: (p.x - n.width / 2 - minX) * scale + 20,
      y: (p.y - n.height / 2 - minY) * scale + 20,
    });
  }
  return out;
}
