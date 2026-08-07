import { describe, it, expect } from "vitest";
import { latexToUnicode } from "./formula";

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

  it("纯 Unicode 公式原样保留", () => {
    expect(latexToUnicode("E = mc²")).toBe("E = mc²");
    expect(latexToUnicode("α β γ")).toBe("α β γ");
  });
});
