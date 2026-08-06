import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt 多模式", () => {
  it("无 modes 时含自动识别与三节规范，不含组合节", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("自动识别");
    expect(p).toContain("科研绘图");
    expect(p).toContain("思维导图");
    expect(p).toContain("图表制作");
    expect(p).not.toContain("图种组合规范");
  });

  it("指定 modes 时含对应节与组合节，不含未选节与自动识别", () => {
    const p = buildSystemPrompt(["sci", "chart"]);
    expect(p).toContain("科研绘图");
    expect(p).toContain("图表制作");
    expect(p).toContain("图种组合规范");
    expect(p).toContain("本次任务模式：多图种组合");
    // COMMON 首句枚举三种模式时会出现「思维导图」字样，这里只断言未选模式的规范节不出现
    expect(p).not.toContain("【思维导图规范】");
    expect(p).not.toContain("自动识别");
  });

  it("科研审美规范含硬数字（统一尺寸/间距/色板）", () => {
    const p = buildSystemPrompt(["sci"]);
    expect(p).toContain("150~180");
    expect(p).toContain("48~60");
    expect(p).toContain("20~60");
    expect(p).toContain("#eef4ff");
    // 颜色上限自洽：语义色 + 强调色不超总计
    expect(p).toContain("总计 ≤4 色");
  });

  it("公共节含画完自查规则", () => {
    expect(buildSystemPrompt()).toContain("画完必须自查");
  });
});
