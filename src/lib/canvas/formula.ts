// 公式源码 → Unicode 渲染文本：把常见 LaTeX 记法转成可直接渲染的 Unicode 数学符号。
// 支撑两种输入：粘贴 LaTeX（\frac{a}{b}、\alpha、x^2、H_2O）与直接粘贴 Unicode 公式（保持原样）。
// 转换是有损的（覆盖论文常用公式记号），超出覆盖范围的未知命令会去掉反斜杠保留字母。

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
  omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ",
  chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  varepsilon: "ε", vartheta: "ϑ", varphi: "φ", varrho: "ϱ", varsigma: "ς",
};

const COMMANDS: Record<string, string> = {
  "\\sum": "∑", "\\int": "∫", "\\oint": "∮", "\\infty": "∞", "\\nabla": "∇",
  "\\partial": "∂", "\\hbar": "ℏ", "\\ell": "ℓ",
  "\\rightarrow": "→", "\\to": "→", "\\leftarrow": "←", "\\leftrightarrow": "↔",
  "\\Rightarrow": "⇒", "\\Leftarrow": "⇐", "\\Leftrightarrow": "⇔",
  "\\leq": "≤", "\\le": "≤", "\\geq": "≥", "\\ge": "≥", "\\neq": "≠", "\\ne": "≠",
  "\\approx": "≈", "\\sim": "∼", "\\equiv": "≡", "\\propto": "∝",
  "\\times": "×", "\\div": "÷", "\\cdot": "·", "\\pm": "±", "\\mp": "∓",
  "\\in": "∈", "\\notin": "∉", "\\subset": "⊂", "\\supset": "⊃", "\\subseteq": "⊆",
  "\\cup": "∪", "\\cap": "∩", "\\forall": "∀", "\\exists": "∃", "\\emptyset": "∅",
  "\\dots": "…", "\\cdots": "⋯", "\\ldots": "…", "\\mid": "|", "\\land": "∧", "\\lor": "∨",
  "\\angle": "∠", "\\perp": "⊥", "\\parallel": "∥", "\\circ": "∘", "\\deg": "°",
  "\\Delta": "Δ", "\\Lambda": "Λ", "\\Sigma": "Σ", "\\Omega": "Ω", "\\Pi": "Π", "\\Phi": "Φ",
};

// 上下标字符表（Unicode）：数字/字母可转上下标的子集
const SUPER: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ",
  "o": "ₒ", "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ",
};

// 取 {} 包裹的内容（无花括号时取单字符）
function braced(src: string, i: number): { inner: string; end: number } | null {
  if (src[i] === "{") {
    const end = src.indexOf("}", i + 1);
    if (end < 0) return null;
    return { inner: src.slice(i + 1, end), end: end + 1 };
  }
  const ch = src[i] ?? "";
  if (!ch) return null;
  if (ch === "\\" || ch === "{" || ch === "}") return null;
  return { inner: ch, end: i + 1 };
}

// 二元关系/运算符命令：LaTeX 里这些符号两侧有间距（a \leq b → a ≤ b），吞空格会挤掉排版
const BINARY_OPS = new Set([
  "leq", "le", "geq", "ge", "neq", "ne", "approx", "sim", "equiv", "propto",
  "times", "div", "cdot", "pm", "mp", "in", "notin", "subset", "supset", "subseteq",
  "cup", "cap", "land", "lor", "to", "rightarrow", "leftarrow", "leftrightarrow",
  "Rightarrow", "Leftarrow", "Leftrightarrow", "mid", "parallel", "perp",
]);

export function latexToUnicode(src: string): string {
  let s = src;
  // \frac{a}{b} → a⁄b（分数斜线）
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  s = s.replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  s = s.replace(/\\tfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  // \sqrt{x} → √x
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√$1");
  // \text{...} / \mathrm{...} / \operatorname{...} → 去掉标记保留内容
  s = s.replace(/\\(text|mathrm|mathbf|mathit|operatorname|textrm)\s*\{([^{}]*)\}/g, "$2");
  // 下标/上标：逐字符处理 ^{...} 与 _{...}
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if ((ch === "^" || ch === "_") && i + 1 < s.length) {
      const b = braced(s, i + 1);
      if (b) {
        const map = ch === "^" ? SUPER : SUB;
        for (const c of b.inner) out += map[c] ?? c;
        i = b.end;
        continue;
      }
    }
    out += ch;
    i++;
  }
  s = out;
  // 希腊字母与命令：命令后的空格是 LaTeX 命令终止符（\Delta E → ΔE）；
  // 但二元关系符（\leq、\geq、\neq…）两侧需要排版间距，且 \alpha + \beta 中 + 前的空格是
  // 运算符间距——仅对"命令后空格+字母"且命令不是二元关系符时吞掉空格
  s = s.replace(/\\([A-Za-z]+) (?=[A-Za-z])/g, (m, name) => {
    const sym = GREEK[name] ?? COMMANDS[`\\${name}`];
    if (sym === undefined) return `${name} `;
    return BINARY_OPS.has(name) ? `${sym} ` : sym;
  });
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ?? COMMANDS[`\\${name}`] ?? name);
  return s;
}

// 傻瓜界面常用模板（点击插入源码）：分数/上下标/根号/求和积分/希腊字母/化学式
export const FORMULA_TEMPLATES: { label: string; insert: string }[] = [
  { label: "分数", insert: "\\frac{a}{b}" },
  { label: "平方", insert: "x^2" },
  { label: "立方", insert: "x^3" },
  { label: "上标", insert: "x^{n}" },
  { label: "下标", insert: "x_{i}" },
  { label: "根号", insert: "\\sqrt{x}" },
  { label: "求和", insert: "\\sum_{i=1}^{n} x_i" },
  { label: "积分", insert: "\\int_{a}^{b} f(x) dx" },
  { label: "极限", insert: "\\lim_{x \\to 0}" },
  { label: "无穷", insert: "\\infty" },
  { label: "概率", insert: "P(A \\mid B)" },
  { label: "期望", insert: "E[X] = \\sum x p(x)" },
  { label: "向量", insert: "\\vec{v} = (v_1, v_2)" },
  { label: "矩阵", insert: "A = [a_{ij}]" },
  { label: "化学式", insert: "H_2O" },
  { label: "二氧化碳", insert: "CO_2" },
  { label: "硫酸", insert: "H_2SO_4" },
  { label: "葡萄糖", insert: "C_6H_{12}O_6" },
];

// 结构类模板（主流公式平台工具栏的分类：分数/根号/上下标/求和积分/括号）
export const STRUCTURE_QUICK: { label: string; insert: string }[] = [
  { label: "分数", insert: "\\frac{a}{b}" },
  { label: "根号", insert: "\\sqrt{x}" },
  { label: "n 次根", insert: "\\sqrt[n]{x}" },
  { label: "上标", insert: "x^{n}" },
  { label: "下标", insert: "x_{i}" },
  { label: "求和", insert: "\\sum_{i=1}^{n}" },
  { label: "积分", insert: "\\int_{a}^{b}" },
  { label: "极限", insert: "\\lim_{x \\to 0}" },
  { label: "括号", insert: "\\left( x \\right)" },
  { label: "大括号", insert: "\\left\\{ x \\right\\}" },
  { label: "绝对值", insert: "\\left| x \\right|" },
  { label: "向量", insert: "\\vec{v}" },
  { label: "矩阵", insert: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
];

// 化学式模板（化学分类）
export const CHEM_QUICK: { label: string; insert: string }[] = [
  { label: "水", insert: "H_2O" },
  { label: "二氧化碳", insert: "CO_2" },
  { label: "氧气", insert: "O_2" },
  { label: "氮气", insert: "N_2" },
  { label: "甲烷", insert: "CH_4" },
  { label: "氨", insert: "NH_3" },
  { label: "硫酸", insert: "H_2SO_4" },
  { label: "盐酸", insert: "HCl" },
  { label: "氢氧化钠", insert: "NaOH" },
  { label: "氯化钠", insert: "NaCl" },
  { label: "葡萄糖", insert: "C_6H_{12}O_6" },
  { label: "可逆反应", insert: "A \\rightleftharpoons B" },
];

// 希腊字母快捷面板
export const GREEK_QUICK: { label: string; insert: string }[] = [
  { label: "α", insert: "\\alpha" },
  { label: "β", insert: "\\beta" },
  { label: "γ", insert: "\\gamma" },
  { label: "δ", insert: "\\delta" },
  { label: "ε", insert: "\\epsilon" },
  { label: "θ", insert: "\\theta" },
  { label: "λ", insert: "\\lambda" },
  { label: "μ", insert: "\\mu" },
  { label: "π", insert: "\\pi" },
  { label: "ρ", insert: "\\rho" },
  { label: "σ", insert: "\\sigma" },
  { label: "τ", insert: "\\tau" },
  { label: "φ", insert: "\\phi" },
  { label: "ω", insert: "\\omega" },
  { label: "Δ", insert: "\\Delta" },
  { label: "Σ", insert: "\\Sigma" },
  { label: "Ω", insert: "\\Omega" },
];

// 常用运算符快捷面板
export const OPERATOR_QUICK: { label: string; insert: string }[] = [
  { label: "≤", insert: "\\leq" },
  { label: "≥", insert: "\\geq" },
  { label: "≠", insert: "\\neq" },
  { label: "≈", insert: "\\approx" },
  { label: "→", insert: "\\to" },
  { label: "↔", insert: "\\leftrightarrow" },
  { label: "⇒", insert: "\\Rightarrow" },
  { label: "×", insert: "\\times" },
  { label: "÷", insert: "\\div" },
  { label: "±", insert: "\\pm" },
  { label: "·", insert: "\\cdot" },
  { label: "∈", insert: "\\in" },
  { label: "⊂", insert: "\\subset" },
  { label: "∪", insert: "\\cup" },
  { label: "∩", insert: "\\cap" },
  { label: "∑", insert: "\\sum" },
  { label: "∫", insert: "\\int" },
  { label: "√", insert: "\\sqrt{}" },
];
