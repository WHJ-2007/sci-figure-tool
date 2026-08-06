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

  it("逻辑节点正文按语义判断：概念型只标题、过程型写要点，同图风格统一", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("标题是否已经完整表达该节点的语义");
    expect(p).toContain("概念/名词型节点");
    expect(p).toContain("2~4 行要点正文");
    expect(p).toContain("同一张图风格统一");
    expect(p).toContain("禁止标题和正文都没有的空白空盒子");
  });

  it("含绘图世界观与统一操作说明书决策表", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("绘图世界观");
    expect(p).toContain("统一操作说明书");
    expect(p).toContain("需求是流程/架构/机制图");
    expect(p).toContain("需求是思维导图");
    expect(p).toContain("需求是数据图表");
  });

  it("公共节含数据来源规范（先搜权威、禁止编造、估算明示）", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("数据来源规范");
    expect(p).toContain("searchWeb");
    expect(p).toContain("禁止凭空编造精确数字");
    expect(p).toContain("该数值为估算，未查到权威来源");
    expect(p).toContain("最多搜索 2 次");
  });

  it("含简笔画配方（灯泡/放大镜等线条组合）且多模式分支同样包含", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("简笔画与图示符号");
    expect(p).toContain("灯泡");
    expect(p).toContain("放大镜");
    const multi = buildSystemPrompt(["sci", "chart"]);
    expect(multi).toContain("绘图世界观");
    expect(multi).toContain("简笔画与图示符号");
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
