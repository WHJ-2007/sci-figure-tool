import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import AutoSave from "./AutoSave";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { saveProjectsToFile, ensureSavePermission } from "@/lib/canvas/saveTarget";

vi.mock("@/lib/canvas/saveTarget", () => ({
  saveProjectsToFile: vi.fn(async () => "saved"),
  ensureSavePermission: vi.fn(async () => true),
}));

beforeEach(() => {
  useCanvasStore.setState(useCanvasStore.getInitialState());
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AutoSave 瞬时保存", () => {
  it("画布数据变化后防抖写入全部画布快照", () => {
    const mocked = vi.mocked(saveProjectsToFile);
    render(<AutoSave />);
    expect(mocked).not.toHaveBeenCalled();
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 50, 30));
    expect(mocked).not.toHaveBeenCalled(); // 防抖期内不写
    vi.advanceTimersByTime(600);
    expect(mocked).toHaveBeenCalledTimes(1);
    const json = JSON.parse(mocked.mock.calls[0][0] as string);
    expect(json).toHaveLength(1);
    expect(json[0].doc.elements).toHaveLength(1);
  });

  it("连续变化合并为一次保存（防抖重置）", () => {
    render(<AutoSave />);
    const s = useCanvasStore.getState();
    s.addElement(makeElement("rect", 0, 0, 50, 30));
    vi.advanceTimersByTime(300);
    s.addElement(makeElement("ellipse", 10, 10, 40, 40));
    vi.advanceTimersByTime(300);
    expect(saveProjectsToFile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(saveProjectsToFile).toHaveBeenCalledTimes(1);
  });

  it("仅选择/视口变化不触发保存", () => {
    render(<AutoSave />);
    const s = useCanvasStore.getState();
    s.setSelection(["x"]);
    s.setView({ scale: 2, ox: 10, oy: 10 });
    vi.advanceTimersByTime(600);
    expect(saveProjectsToFile).not.toHaveBeenCalled();
  });

  it("权限失效时重授权后重存一次", async () => {
    vi.mocked(saveProjectsToFile).mockResolvedValueOnce("denied");
    render(<AutoSave />);
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 50, 30));
    vi.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
    expect(ensureSavePermission).toHaveBeenCalled();
    expect(saveProjectsToFile).toHaveBeenCalledTimes(2);
  });

  it("卸载后不再保存", () => {
    const { unmount } = render(<AutoSave />);
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 50, 30));
    unmount();
    vi.advanceTimersByTime(600);
    expect(saveProjectsToFile).not.toHaveBeenCalled();
  });
});
