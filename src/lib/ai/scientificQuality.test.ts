import { describe, expect, it } from "vitest";
import { makeElement } from "@/lib/canvas/elements";
import type { CanvasDocument } from "@/lib/canvas/types";
import { auditScientificFigure, correctScientificFigure } from "./scientificQuality";

describe("科研图结构化质量门禁", () => {
  it("用对象坐标识别节点遮挡，并给出可执行纠错与验收证据", () => {
    const a = makeElement("logic", 100, 100, 160, 70, { text: "数据输入", scientificRole: "node", scientificId: "input" });
    const b = makeElement("logic", 220, 120, 160, 70, { text: "特征编码", scientificRole: "node", scientificId: "encoder" });
    const doc: CanvasDocument = { width: 1600, height: 1000, elements: [a, b] };

    const report = auditScientificFigure(doc);
    expect(report.passed).toBe(false);
    expect(report.metrics.overlappingNodePairs).toBe(1);
    expect(report.findings[0]).toMatchObject({ category: "overlap", severity: "hard" });
    expect(report.findings[0].evidence).toContain("40×50 px");

    const corrected = correctScientificFigure(doc, report);
    const after = auditScientificFigure(corrected.document);
    expect(corrected.corrections).toHaveLength(1);
    expect(after.metrics.overlappingNodePairs).toBe(0);
    expect(after.passed).toBe(true);
  });

  it("区分科研节点与容器/装饰，不把合法包含关系误报为遮挡", () => {
    const panel = makeElement("rounded", 60, 60, 500, 240, { scientificRole: "container", scientificId: "training" });
    const node = makeElement("logic", 140, 130, 170, 70, { text: "模型训练", scientificRole: "node", scientificRegionId: "training" });
    const report = auditScientificFigure({ width: 1600, height: 1000, elements: [panel, node] });
    expect(report.metrics.nodes).toBe(1);
    expect(report.metrics.overlappingNodePairs).toBe(0);
    expect(report.passed).toBe(true);
  });
});
