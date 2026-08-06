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

  it("逻辑节点正文必填：公共节与科研规范都禁止空盒子", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("逻辑节点（语义模块框）必须写正文");
    expect(p).toContain("禁止只有标题的空盒子");
    expect(p).toContain("正文用 body 参数写且必填");
  });

  it("收尾话术简练：交代总数，不要求复述操作步骤", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("共 15 个元素");
    expect(p).toContain("操作步骤已在界面左下角活动日志逐条显示");
    expect(p).toContain("禁止复述步骤");
  });

  it("科研规范教箭头样式（head）与层级（zIndex）与粗细联动", () => {
    const p = buildSystemPrompt(["sci"]);
    expect(p).toContain("head 参数控制");
    expect(p).toContain("double 两端箭头");
    expect(p).toContain("zIndex 数值大者在上");
    expect(p).toContain("头随粗细自动变大");
  });
});
