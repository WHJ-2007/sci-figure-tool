import { describe, expect, it } from "vitest";
import { DraftCanvas } from "./draft";

describe("CNN paper figure renderer", () => {
  it("generates tensor stacks, receptive field, kernel and class probabilities", () => {
    const draft = new DraftCanvas([]);
    const result = draft.applyCNNArchitecture({});
    expect(result.ok).toBe(true);
    expect(result.quality?.passed).toBe(true);
    const elements = draft.serialize().elements;
    expect(elements.filter((e) => e.scientificId?.startsWith("cnn-stage-") && e.scientificRole === "node")).toHaveLength(4);
    expect(elements.filter((e) => e.scientificId?.endsWith("-depth")).length).toBeGreaterThanOrEqual(12);
    expect(elements.filter((e) => e.scientificId === "receptive-grid")).toHaveLength(36);
    expect(elements.filter((e) => e.scientificId === "kernel-cell")).toHaveLength(9);
    expect(elements.some((e) => e.scientificId === "classifier-head")).toBe(true);
    expect(elements.filter((e) => e.scientificId?.startsWith("probability-")).length).toBeGreaterThanOrEqual(4);
    const occupied = elements.filter((e) => e.scientificRole !== "title");
    expect(Math.max(...occupied.map((e) => e.x + e.width)) - Math.min(...occupied.map((e) => e.x))).toBeGreaterThan(1400);
    expect(Math.max(...occupied.map((e) => e.y + e.height)) - Math.min(...occupied.map((e) => e.y))).toBeGreaterThan(780);
  });

  it("upgrades a weak model's generic CNN flowchart call to the dedicated renderer", () => {
    const draft = new DraftCanvas([]);
    const result = draft.applyScientificDiagram({
      title: "卷积神经网络 CNN 结构详解",
      domain: "machine-learning",
      nodes: [
        { id: "input", text: "输入图像", role: "data" },
        { id: "conv1", text: "卷积层 C1", role: "neural-network", detail: "3×3 卷积核 32 filters" },
        { id: "pool1", text: "池化层 P1", role: "process", detail: "2×2 最大池化" },
        { id: "conv2", text: "卷积层 C2", role: "neural-network", detail: "3×3 卷积核 64 filters" },
        { id: "output", text: "Softmax 分类", role: "output" },
      ],
      edges: [
        { from: "input", to: "conv1" },
        { from: "conv1", to: "pool1" },
        { from: "pool1", to: "conv2" },
        { from: "conv2", to: "output" },
      ],
    });
    expect(result.ok).toBe(true);
    const elements = draft.serialize().elements;
    expect(elements.some((e) => e.scientificId === "receptive-window")).toBe(true);
    expect(elements.some((e) => e.scientificId === "classifier-head")).toBe(true);
    expect(elements.filter((e) => e.type === "logic")).toHaveLength(0);
  });
});
