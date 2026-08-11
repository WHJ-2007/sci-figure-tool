import { describe, it, expect } from "vitest";
import { latexToUnicode, parseFormulaStructures, applySlotEdit } from "./formula";

describe("latexToUnicode", () => {
  it("分数转斜线", () => {
    expect(latexToUnicode("\\frac{a}{b}")).toBe("(a)⁄(b)");
    expect(latexToUnicode("\\frac{1}{2}")).toBe("(1)⁄(2)");
  });

  it("上下标转 Unicode", () => {
    expect(latexToUnicode("x^2")).toBe("x²");
    expect(latexToUnicode("x^3")).toBe("x³");
    expect(latexToUnicode("H_2O")).toBe("H₂O");
    expect(latexToUnicode("C_6H_{12}O_6")).toBe("C₆H₁₂O₆");
    expect(latexToUnicode("x^{n+1}")).toBe("xⁿ⁺¹");
  });

  it("希腊字母与运算符", () => {
    expect(latexToUnicode("\\alpha + \\beta")).toBe("α + β");
    expect(latexToUnicode("\\sum_{i=1}^{n} x_i")).toBe("∑ᵢ₌₁ⁿ xᵢ");
    expect(latexToUnicode("\\infty \\to \\infty")).toBe("∞ → ∞");
    expect(latexToUnicode("\\Delta E = mc^2")).toBe("ΔE = mc²");
    expect(latexToUnicode("a \\leq b \\geq c")).toBe("a ≤ b ≥ c");
    expect(latexToUnicode("x \\neq y \\approx z")).toBe("x ≠ y ≈ z");
  });

  it("根号与文本标记", () => {
    expect(latexToUnicode("\\sqrt{x}")).toBe("√x");
    expect(latexToUnicode("\\mathrm{H}_2O")).toBe("H₂O");
  });

  it("化学式工具：可逆符号与角标", () => {
    expect(latexToUnicode("A \\rightleftharpoons B")).toBe("A ⇌ B");
    expect(latexToUnicode("A \\leftrightharpoons B")).toBe("A ⇋ B");
    expect(latexToUnicode("A \\rightleftarrows B")).toBe("A ⇄ B");
    expect(latexToUnicode("\\mathrm{Fe}^{3+}")).toBe("Fe³⁺");
    expect(latexToUnicode("x_{n}")).toBe("xₙ");
  });

  it("结构命令彻查：n 次根 / 极限 / 积分 / 向量 / 括号 / 矩阵", () => {
    expect(latexToUnicode("\\sqrt[n]{x}")).toBe("ⁿ√x");
    expect(latexToUnicode("\\sqrt[3]{8}")).toBe("³√8");
    // 极限下标内的操作符两侧保留排版空格（limₓ → ₀）
    expect(latexToUnicode("\\lim_{x \\to 0}")).toBe("limₓ → ₀");
    expect(latexToUnicode("\\int_{a}^{b} f(x) dx")).toBe("∫ₐᵇ f(x) dx");
    expect(latexToUnicode("\\vec{v}")).toBe("v⃗");
    expect(latexToUnicode("\\left( x \\right)")).toBe("( x )");
    expect(latexToUnicode("\\left\\{ x \\right\\}")).toBe("{ x }");
    expect(latexToUnicode("\\left| x \\right|")).toBe("| x |");
    expect(latexToUnicode("\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}")).toBe("[a b; c d]");
  });

  it("纯 Unicode 公式原样保留", () => {
    expect(latexToUnicode("E = mc²")).toBe("E = mc²");
    expect(latexToUnicode("α β γ")).toBe("α β γ");
  });
});

describe("parseFormulaStructures / applySlotEdit（分位置编辑）", () => {
  it("求和公式：解析出上面/下面槽位", () => {
    const sts = parseFormulaStructures("\\sum_{i=1}^{n} x_i");
    expect(sts[0].kind).toBe("sum");
    expect(sts[0].slots.map((s) => s.label)).toEqual(["上面", "下面"]);
    expect(sts[0].slots[0].value).toBe("n");
    expect(sts[0].slots[1].value).toBe("i=1");
  });

  it("积分公式：上下限槽位", () => {
    const sts = parseFormulaStructures("\\int_{a}^{b} f(x) dx");
    expect(sts[0].kind).toBe("int");
    expect(sts[0].slots.map((s) => s.label)).toEqual(["上面", "下面"]);
    expect(sts[0].slots[0].value).toBe("b");
    expect(sts[0].slots[1].value).toBe("a");
  });

  it("分数公式：分子/分母槽位", () => {
    const sts = parseFormulaStructures("\\frac{a}{b} + \\frac{c}{d}");
    expect(sts).toHaveLength(2);
    expect(sts[0].slots.map((s) => s.label)).toEqual(["分子", "分母"]);
    expect(sts[0].slots[0].value).toBe("a");
    expect(sts[0].slots[1].value).toBe("b");
    expect(sts[1].slots[1].value).toBe("d");
  });

  it("根号与 n 次根：被开方数 / 根指数槽位", () => {
    expect(parseFormulaStructures("\\sqrt{x}")[0].slots.map((s) => s.label)).toEqual(["被开方数"]);
    const n = parseFormulaStructures("\\sqrt[n]{x}");
    expect(n[0].slots.map((s) => s.label)).toEqual(["根指数", "被开方数"]);
    expect(n[0].slots[0].value).toBe("n");
  });

  it("裸上下标单独解析", () => {
    const sts = parseFormulaStructures("x^{n+1} + H_2O");
    expect(sts.map((s) => s.kind)).toEqual(["sup", "sub"]);
    expect(sts[0].slots[0].value).toBe("n+1");
    expect(sts[1].slots[0].value).toBe("2");
  });

  it("applySlotEdit：只改对应区间，其余源码不动", () => {
    const src = "\\sum_{i=1}^{n} x_i";
    const sts = parseFormulaStructures(src);
    // 改上面 n → N，改下面 i=1 → k=0
    let next = applySlotEdit(src, sts[0].slots[0].start, sts[0].slots[0].end, "N");
    expect(next).toBe("\\sum_{i=1}^{N} x_i");
    const sts2 = parseFormulaStructures(next);
    next = applySlotEdit(next, sts2[0].slots[1].start, sts2[0].slots[1].end, "k=0");
    expect(next).toBe("\\sum_{k=0}^{N} x_i");
    expect(latexToUnicode(next)).toBe("∑ₖ₌₀ᴺ xᵢ");
  });
});
