import { describe, it, expect } from "vitest";
import { createHistory, pushHistory, undo, redo } from "./history";
import { makeElement } from "./elements";
import type { CanvasDocument } from "./types";

function doc(elements: CanvasDocument["elements"]): CanvasDocument {
  return { width: 1600, height: 1000, elements };
}

describe("history", () => {
  it("push 后 undo 回到快照、redo 恢复", () => {
    let h = createHistory();
    const d1 = doc([]);
    h = pushHistory(h, d1);
    const d2 = doc([makeElement("rect", 0, 0, 100, 60, { id: "x" })]);
    const after = undo(h, d2);
    expect(after).not.toBeNull();
    expect(after!.doc.elements).toEqual([]);
    const redone = redo(after!.history, after!.doc);
    expect(redone!.doc).toEqual(d2);
  });

  it("快照为深拷贝，后续修改不影响历史", () => {
    let h = createHistory();
    const d1 = doc([]);
    h = pushHistory(h, d1);
    d1.elements.push({} as any);
    const after = undo(h, doc([]));
    expect(after!.doc.elements).toHaveLength(0);
  });

  it("超过上限丢弃最旧快照", () => {
    let h = createHistory(2);
    for (let i = 0; i < 5; i++) h = pushHistory(h, doc([]));
    expect(h.past.length).toBe(2);
  });

  it("无可撤销时 undo 返回 null", () => {
    expect(undo(createHistory(), doc([]))).toBeNull();
  });

  it("无可重做时 redo 返回 null", () => {
    expect(redo(createHistory(), doc([]))).toBeNull();
  });

  it("撤销后 push 清空未来栈，redo 不可用", () => {
    let h = createHistory();
    h = pushHistory(h, doc([]));
    const after = undo(h, doc([]));
    expect(after).not.toBeNull();
    expect(after!.history.future.length).toBeGreaterThan(0);
    h = pushHistory(after!.history, doc([]));
    expect(h.future).toHaveLength(0);
    expect(redo(h, doc([]))).toBeNull();
  });
});
