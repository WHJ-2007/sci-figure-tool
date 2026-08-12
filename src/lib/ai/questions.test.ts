import { describe, expect, it } from "vitest";
import { ensureOtherOption, isOtherOption } from "./questions";

describe("question options", () => {
  it("去重并强制把其他放在最后，同时保持最多 5 项", () => {
    expect(ensureOtherOption(["柱状图", "其他", "折线图", "柱状图", "饼图", "散点图", "面积图"]))
      .toEqual(["柱状图", "折线图", "饼图", "散点图", "其他"]);
  });

  it("兼容其它与英文 Other，不提供选项时保持无按钮模式", () => {
    expect(ensureOtherOption(["A", "Other"])).toEqual(["A", "其他"]);
    expect(isOtherOption("其它")).toBe(true);
    expect(ensureOtherOption()).toBeUndefined();
  });
});
