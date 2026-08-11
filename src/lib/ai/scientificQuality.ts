import { anchorToward, shapeExitPoint, type Point } from "@/lib/canvas/geometry";
import { logicBoxSize } from "@/lib/canvas/elements";
import type { ArrowElement, CanvasDocument, CanvasElement } from "@/lib/canvas/types";

// Backend-neutral quality protocol adapted for an editable SVG canvas from the MIT-licensed
// scientific-illustrator project. No PowerPoint/MCP/COM implementation is copied here.
export type ScientificFindingCategory =
  | "topology" | "editability" | "clipping" | "overlap" | "text-fit"
  | "spacing" | "alignment" | "connector-intrusion" | "connector-crossing"
  | "typography" | "palette";

export interface ScientificQualityFinding {
  id: string;
  region: string;
  objects: string[];
  category: ScientificFindingCategory;
  severity: "hard" | "warning";
  evidence: string;
  correction: string;
  acceptance: string;
  confidence: number;
}

export interface ScientificQualityScores {
  topology: number;
  editability: number;
  geometry: number;
  spacing: number;
  connectorClarity: number;
  typographyColor: number;
  clippingOverlap: number;
}

export interface ScientificQualityReport {
  protocol: "designer-drawer-reviewer-corrector";
  passed: boolean;
  hardFailures: number;
  warnings: number;
  scores: ScientificQualityScores;
  metrics: {
    nodes: number;
    connectors: number;
    minNodeGap: number | null;
    connectorIntrusions: number;
    connectorCrossings: number;
    outOfBounds: number;
    overlappingNodePairs: number;
  };
  findings: ScientificQualityFinding[];
  limitation: string;
}

type Rect = { x: number; y: number; width: number; height: number };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const roundScore = (n: number) => Math.round(clamp01(n) * 1000) / 1000;
const rectRight = (r: Rect) => r.x + r.width;
const rectBottom = (r: Rect) => r.y + r.height;

function intersection(a: Rect, b: Rect): { width: number; height: number; area: number } {
  const width = Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y));
  return { width, height, area: width * height };
}

function pointInside(p: Point, r: Rect, inset = 2): boolean {
  return p.x > r.x + inset && p.x < rectRight(r) - inset && p.y > r.y + inset && p.y < rectBottom(r) - inset;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  return o1 * o2 < -0.01 && o3 * o4 < -0.01;
}

function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInside(a, r) || pointInside(b, r)) return true;
  const tl = { x: r.x, y: r.y }, tr = { x: rectRight(r), y: r.y };
  const br = { x: rectRight(r), y: rectBottom(r) }, bl = { x: r.x, y: rectBottom(r) };
  return segmentsCross(a, b, tl, tr) || segmentsCross(a, b, tr, br)
    || segmentsCross(a, b, br, bl) || segmentsCross(a, b, bl, tl);
}

function arrowPoints(e: ArrowElement): Point[] {
  return [
    { x: e.x, y: e.y },
    ...(e.midPoints ?? []).map((p) => ({ x: e.x + p.x, y: e.y + p.y })),
    { x: e.x + e.width, y: e.y + e.height },
  ];
}

function finding(
  findings: ScientificQualityFinding[], category: ScientificFindingCategory,
  severity: "hard" | "warning", objects: string[], evidence: string,
  correction: string, acceptance: string, region = "figure", confidence = 1
) {
  findings.push({ id: `SQ-${findings.length + 1}`, region, objects, category, severity, evidence, correction, acceptance, confidence });
}

function scientificParts(elements: CanvasElement[]) {
  const tagged = elements.some((e) => e.scientificRole !== undefined);
  const connectors = elements.filter((e): e is ArrowElement => e.type === "arrow" && (e.scientificRole === "connector" || (!tagged && Boolean(e.startId && e.endId))));
  const endpointIds = new Set(connectors.flatMap((e) => [e.startId, e.endId]).filter((id): id is string => Boolean(id)));
  const nodes = elements.filter((e) => e.scientificRole === "node" || endpointIds.has(e.id) || (!tagged && e.type === "logic"));
  const containers = elements.filter((e) => e.scientificRole === "container");
  return { tagged, nodes, connectors, containers };
}

export function hasScientificFigure(elements: CanvasElement[]): boolean {
  const { nodes, connectors } = scientificParts(elements);
  return elements.some((e) => e.scientificRole !== undefined) || (nodes.length >= 2 && connectors.length >= 1);
}

export function auditScientificFigure(doc: CanvasDocument): ScientificQualityReport {
  const findings: ScientificQualityFinding[] = [];
  const { nodes, connectors } = scientificParts(doc.elements);
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  let outOfBounds = 0, overlaps = 0, intrusions = 0, crossings = 0;
  let minNodeGap = Infinity;

  for (const e of [...nodes, ...connectors]) {
    const points = e.type === "arrow" ? arrowPoints(e) : [{ x: e.x, y: e.y }, { x: rectRight(e), y: rectBottom(e) }];
    if (points.some((p) => p.x < 0 || p.y < 0 || p.x > doc.width || p.y > doc.height)) {
      outOfBounds++;
      finding(findings, "clipping", "hard", [e.id], `元素坐标超出 ${doc.width}×${doc.height} 画布。`, "将元素移回安全边距内。", "所有可见坐标均位于画布内。", e.scientificRegionId);
    }
  }

  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const hit = intersection(a, b);
    if (hit.area > 4) {
      overlaps++;
      finding(findings, "overlap", "hard", [a.id, b.id], `节点包围盒重叠 ${Math.round(hit.width)}×${Math.round(hit.height)} px。`, "移动后一个节点并保持至少 28 px 净距。", "节点包围盒不相交。", a.scientificRegionId ?? b.scientificRegionId);
    } else {
      const dx = Math.max(a.x - rectRight(b), b.x - rectRight(a), 0);
      const dy = Math.max(a.y - rectBottom(b), b.y - rectBottom(a), 0);
      const gap = Math.hypot(dx, dy);
      if (gap > 0) minNodeGap = Math.min(minNodeGap, gap);
      if (gap > 0 && gap < 20 && (intersection({ ...a, x: a.x - 4, width: a.width + 8 }, b).height > 0 || intersection({ ...a, y: a.y - 4, height: a.height + 8 }, b).width > 0)) {
        finding(findings, "spacing", "warning", [a.id, b.id], `相邻节点净距仅 ${Math.round(gap)} px。`, "沿主阅读方向增大间距。", "相邻节点净距至少 20 px。", a.scientificRegionId ?? b.scientificRegionId);
      }
    }
  }

  for (const node of nodes) {
    if (node.type === "logic") {
      const needed = logicBoxSize(node.text, node.body, node.fontSize, node.bold);
      if (node.width + 0.5 < needed.width || node.height + 0.5 < needed.height) {
        finding(findings, "text-fit", "hard", [node.id], `文字需要约 ${Math.ceil(needed.width)}×${Math.ceil(needed.height)} px，节点仅 ${Math.round(node.width)}×${Math.round(node.height)} px。`, "扩展节点以容纳全部文字。", "文字估算尺寸不超过节点内部尺寸。", node.scientificRegionId);
      }
      if (node.fontSize < 11) finding(findings, "typography", "warning", [node.id], `节点字号为 ${node.fontSize}px，缩放后可读性不足。`, "将节点字号提高到至少 11px。", "节点字号不低于 11px。", node.scientificRegionId);
    }
  }

  const connectorSegments = connectors.map((arrow) => ({ arrow, points: arrowPoints(arrow) }));
  for (const { arrow, points } of connectorSegments) {
    if (!arrow.startId || !arrow.endId || !byId.has(arrow.startId) || !byId.has(arrow.endId)) {
      finding(findings, "topology", "hard", [arrow.id], "连线缺少有效的源/目标对象引用。", "重新绑定连线端点。", "源与目标 id 均存在且可编辑。", arrow.scientificRegionId);
      continue;
    }
    const unrelated = nodes.filter((n) => n.id !== arrow.startId && n.id !== arrow.endId);
    const hit = unrelated.find((n) => points.slice(0, -1).some((p, i) => segmentHitsRect(p, points[i + 1], n)));
    if (hit) {
      intrusions++;
      finding(findings, "connector-intrusion", "hard", [arrow.id, hit.id], "连线路径穿过无关节点内部。", "把连线改为在节点外侧绕行的正交路径。", "每一段连线均不进入无关节点包围盒。", arrow.scientificRegionId ?? hit.scientificRegionId);
    }
  }
  for (let i = 0; i < connectorSegments.length; i++) for (let j = i + 1; j < connectorSegments.length; j++) {
    const a = connectorSegments[i], b = connectorSegments[j];
    if ([a.arrow.startId, a.arrow.endId].some((id) => id && (id === b.arrow.startId || id === b.arrow.endId))) continue;
    const crossed = a.points.slice(0, -1).some((p, ai) => b.points.slice(0, -1).some((q, bi) => segmentsCross(p, a.points[ai + 1], q, b.points[bi + 1])));
    if (crossed) {
      crossings++;
      finding(findings, "connector-crossing", "warning", [a.arrow.id, b.arrow.id], "两条无关连线发生交叉。", "分配不同的正交连线路径或交换节点顺序。", "无关连线不交叉。", a.arrow.scientificRegionId ?? b.arrow.scientificRegionId);
    }
  }

  const images = doc.elements.filter((e) => e.type === "image");
  if (images.length) finding(findings, "editability", "warning", images.map((e) => e.id), `图中含 ${images.length} 个位图对象，部分语义不可拆分编辑。`, "优先使用原生形状、文字与矢量连线重绘核心信息。", "关键科研语义均由可编辑对象承载。");
  const nodeColors = new Set(nodes.map((e) => e.fill.toLowerCase()).filter((c) => c !== "#ffffff" && c !== "none"));
  if (nodeColors.size > 5) finding(findings, "palette", "warning", nodes.map((e) => e.id), `节点使用了 ${nodeColors.size} 种填充色，超过论文图建议的有限语义调色板。`, "合并同义颜色，并确保每种颜色对应稳定语义。", "节点填充色不超过 5 种且语义一致。");

  const hard = findings.filter((f) => f.severity === "hard").length;
  const warnings = findings.length - hard;
  const topologyIssues = findings.filter((f) => f.category === "topology").length;
  const textIssues = findings.filter((f) => f.category === "text-fit" || f.category === "typography" || f.category === "palette").length;
  const scores: ScientificQualityScores = {
    topology: roundScore(1 - topologyIssues / Math.max(1, connectors.length)),
    editability: roundScore(1 - images.length / Math.max(1, doc.elements.length)),
    geometry: roundScore(1 - (outOfBounds + overlaps) / Math.max(1, nodes.length)),
    spacing: roundScore(1 - findings.filter((f) => f.category === "spacing" || f.category === "alignment").length / Math.max(1, nodes.length)),
    connectorClarity: roundScore(1 - (intrusions + crossings + topologyIssues) / Math.max(1, connectors.length)),
    typographyColor: roundScore(1 - textIssues / Math.max(1, nodes.length)),
    clippingOverlap: outOfBounds + overlaps === 0 ? 1 : 0,
  };
  const passed = hard === 0 && scores.topology === 1 && scores.editability === 1
    && scores.clippingOverlap === 1 && scores.geometry >= 0.95 && scores.connectorClarity >= 0.95;
  return {
    protocol: "designer-drawer-reviewer-corrector", passed, hardFailures: hard, warnings, scores,
    metrics: { nodes: nodes.length, connectors: connectors.length, minNodeGap: Number.isFinite(minNodeGap) ? Math.round(minNodeGap * 10) / 10 : null, connectorIntrusions: intrusions, connectorCrossings: crossings, outOfBounds, overlappingNodePairs: overlaps },
    findings,
    limitation: "该门禁验证结构、几何、排版与可编辑性；科研事实、实验结论和领域语义仍需模型或作者核对。",
  };
}

function reroute(arrow: ArrowElement, nodes: CanvasElement[]): ArrowElement {
  const source = nodes.find((n) => n.id === arrow.startId);
  const target = nodes.find((n) => n.id === arrow.endId);
  if (!source || !target) return arrow;
  const sc = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const start = anchorToward(source, tc) ?? shapeExitPoint(source, sc, tc) ?? sc;
  const end = anchorToward(target, sc) ?? shapeExitPoint(target, sc, tc) ?? tc;
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const lane = horizontal
    ? Math.max(16, Math.min(...nodes.filter((n) => n.id !== source.id && n.id !== target.id).map((n) => n.y), start.y, end.y) - 32)
    : Math.max(16, Math.min(...nodes.filter((n) => n.id !== source.id && n.id !== target.id).map((n) => n.x), start.x, end.x) - 32);
  const midPoints = horizontal
    ? [{ x: 0, y: lane - start.y }, { x: end.x - start.x, y: lane - start.y }]
    : [{ x: lane - start.x, y: 0 }, { x: lane - start.x, y: end.y - start.y }];
  return { ...arrow, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y, midPoints };
}

export function correctScientificFigure(doc: CanvasDocument, report = auditScientificFigure(doc)): { document: CanvasDocument; corrections: string[] } {
  const elements = structuredClone(doc.elements);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const corrections: string[] = [];
  for (const f of report.findings.filter((item) => item.severity === "hard")) {
    if (f.category === "clipping") {
      const e = byId.get(f.objects[0]);
      if (!e) continue;
      if (e.type === "arrow") continue;
      e.width = Math.min(e.width, doc.width - 24); e.height = Math.min(e.height, doc.height - 24);
      e.x = Math.max(12, Math.min(e.x, doc.width - e.width - 12));
      e.y = Math.max(12, Math.min(e.y, doc.height - e.height - 12));
      corrections.push(`将 ${e.id} 移回画布安全区`);
    } else if (f.category === "overlap") {
      const a = byId.get(f.objects[0]), b = byId.get(f.objects[1]);
      if (!a || !b) continue;
      const hit = intersection(a, b);
      if (hit.width <= hit.height) b.x = Math.min(doc.width - b.width - 12, rectRight(a) + 28);
      else b.y = Math.min(doc.height - b.height - 12, rectBottom(a) + 28);
      corrections.push(`分离重叠节点 ${a.id} / ${b.id}`);
    } else if (f.category === "text-fit") {
      const e = byId.get(f.objects[0]);
      if (e?.type !== "logic") continue;
      const needed = logicBoxSize(e.text, e.body, e.fontSize, e.bold);
      e.width = Math.max(e.width, needed.width); e.height = Math.max(e.height, needed.height);
      corrections.push(`扩展 ${e.id} 以容纳文字`);
    }
  }
  const { nodes } = scientificParts(elements);
  for (const f of report.findings.filter((item) => item.category === "connector-intrusion")) {
    const e = byId.get(f.objects[0]);
    if (e?.type !== "arrow") continue;
    Object.assign(e, reroute(e, nodes));
    corrections.push(`为 ${e.id} 重算外侧正交路径`);
  }
  return { document: { ...doc, elements }, corrections };
}
