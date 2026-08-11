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
  "\\rightleftharpoons": "⇌", "\\leftrightharpoons": "⇋", "\\rightleftarrows": "⇄",
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
  "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ", "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "j": "ʲ", "k": "ᵏ",
  "l": "ˡ", "m": "ᵐ", "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ", "v": "ᵛ", "w": "ʷ",
  "x": "ˣ", "y": "ʸ", "z": "ᶻ",
  "A": "ᴬ", "B": "ᴮ", "D": "ᴰ", "E": "ᴱ", "H": "ᴴ", "I": "ᴵ", "K": "ᴷ", "L": "ᴸ", "M": "ᴹ", "N": "ᴺ",
  "O": "ᴼ", "P": "ᴾ", "R": "ᴿ", "T": "ᵀ", "U": "ᵁ", "V": "ⱽ", "W": "ᵂ",
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
  "rightleftharpoons", "leftrightharpoons", "rightleftarrows",
]);

export function latexToUnicode(src: string): string {
  let s = src;
  // \frac{a}{b} → a⁄b（分数斜线）
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  s = s.replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  s = s.replace(/\\tfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)");
  // n 次根：\sqrt[n]{x} → ⁿ√x（n 转上标；优先于普通根号）
  s = s.replace(/\\sqrt\s*\[([^{}\]]+)\]\s*\{([^{}]*)\}/g, (_m, n, body) => {
    let ns = "";
    for (const c of n.trim()) ns += SUPER[c] ?? c;
    return `${ns}√${body}`;
  });
  // \sqrt{x} → √x
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√$1");
  // 矩阵：\begin{bmatrix} a & b \\ c & d \end{bmatrix} → [a b; c d]
  s = s.replace(/\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/g, (_m: string, inner: string) => {
    const rows = inner.split(/\\\\/).map((r: string) => r.split("&").map((x: string) => x.trim()).join(" "));
    return `[${rows.join("; ")}]`;
  });
  // \text{...} / \mathrm{...} / \operatorname{...} → 去掉标记保留内容
  s = s.replace(/\\(text|mathrm|mathbf|mathit|operatorname|textrm)\s*\{([^{}]*)\}/g, "$2");
  // \left( \right) \left\{ \right\} \left| \right| → 去标记保留符号
  s = s.replace(/\\left\\?([([{\|])/g, "$1");
  s = s.replace(/\\right\\?([)\]}\|])/g, "$1");
  // \vec{v} → v⃗（向量上箭头）
  s = s.replace(/\\vec\s*\{([^{}]*)\}/g, "$1⃗");
  // 希腊字母与命令：命令后的空格是 LaTeX 命令终止符（\Delta E → ΔE）；
  // 但二元关系符（\leq、\geq、\neq…）两侧需要排版间距，且 \alpha + \beta 中 + 前的空格是
  // 运算符间距——仅对"命令后空格+字母"且命令不是二元关系符时吞掉空格
  // 必须在上下标处理之前：\lim_{x \to 0} 需先把 \to 转成 →，再处理下标，
  // 否则 \to 里的 t/o 会被逐字符误转成下标字符（\ₜₒ 残留反斜杠）
  s = s.replace(/\\([A-Za-z]+) (?=[A-Za-z])/g, (m, name) => {
    const sym = GREEK[name] ?? COMMANDS[`\\${name}`];
    if (sym === undefined) return `${name} `;
    return BINARY_OPS.has(name) ? `${sym} ` : sym;
  });
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ?? COMMANDS[`\\${name}`] ?? name);
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

// 结构类模板（主流公式平台工具栏的分类：分数/根号/上下标/求和积分/括号）。
// symbol = 按钮上直接显示的符号预览（一眼找到所需结构），insert = 点击插入的 LaTeX 源码
export const STRUCTURE_QUICK: { label: string; symbol: string; insert: string }[] = [
  { label: "分数", symbol: "a⁄b", insert: "\\frac{a}{b}" },
  { label: "根号", symbol: "√x", insert: "\\sqrt{x}" },
  { label: "n 次根", symbol: "ⁿ√x", insert: "\\sqrt[n]{x}" },
  { label: "上标", symbol: "xⁿ", insert: "x^{n}" },
  { label: "下标", symbol: "xᵢ", insert: "x_{i}" },
  { label: "求和", symbol: "∑", insert: "\\sum_{i=1}^{n}" },
  { label: "积分", symbol: "∫", insert: "\\int_{a}^{b}" },
  { label: "极限", symbol: "lim", insert: "\\lim_{x \\to 0}" },
  { label: "括号", symbol: "(x)", insert: "\\left( x \\right)" },
  { label: "大括号", symbol: "{x}", insert: "\\left\\{ x \\right\\}" },
  { label: "绝对值", symbol: "|x|", insert: "\\left| x \\right|" },
  { label: "向量", symbol: "v⃗", insert: "\\vec{v}" },
  { label: "矩阵", symbol: "[a b]", insert: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
];

// 化学式快捷面板：只保留「打字打不出来的」工具——角标（下标/上标/离子电荷）与反应符号；
// 化学式本身（H_2O、CO_2…）可直接键入字母+下标，不再内置模板。
// symbol = 按钮上直接显示的符号预览，insert = 点击插入的 LaTeX 源码
export const CHEM_QUICK: { label: string; symbol: string; insert: string }[] = [
  { label: "下标", symbol: "xₙ", insert: "x_{n}" },
  { label: "上标", symbol: "xⁿ", insert: "x^{n}" },
  { label: "离子", symbol: "Fe³⁺", insert: "\\mathrm{Fe}^{3+}" },
  { label: "可逆", symbol: "⇌", insert: "A \\rightleftharpoons B" },
  { label: "左可逆", symbol: "⇋", insert: "A \\leftrightharpoons B" },
  { label: "双向", symbol: "⇄", insert: "A \\rightleftarrows B" },
  { label: "正反应", symbol: "→", insert: "A \\rightarrow B" },
  { label: "逆反应", symbol: "←", insert: "A \\leftarrow B" },
  { label: "升温", symbol: "Δ", insert: "\\Delta" },
  { label: "气体", symbol: "↑", insert: "\\uparrow" },
  { label: "沉淀", symbol: "↓", insert: "\\downarrow" },
];

// 希腊字母快捷面板：完整小写 + 大写，点击直接插入 Unicode 符号（可键入内容作为补充）
export const GREEK_QUICK: { label: string; insert: string }[] = [
  { label: "α", insert: "α" }, { label: "β", insert: "β" }, { label: "γ", insert: "γ" },
  { label: "δ", insert: "δ" }, { label: "ε", insert: "ε" }, { label: "ζ", insert: "ζ" },
  { label: "η", insert: "η" }, { label: "θ", insert: "θ" }, { label: "ι", insert: "ι" },
  { label: "κ", insert: "κ" }, { label: "λ", insert: "λ" }, { label: "μ", insert: "μ" },
  { label: "ν", insert: "ν" }, { label: "ξ", insert: "ξ" }, { label: "ο", insert: "ο" },
  { label: "π", insert: "π" }, { label: "ρ", insert: "ρ" }, { label: "σ", insert: "σ" },
  { label: "τ", insert: "τ" }, { label: "υ", insert: "υ" }, { label: "φ", insert: "φ" },
  { label: "χ", insert: "χ" }, { label: "ψ", insert: "ψ" }, { label: "ω", insert: "ω" },
  { label: "Α", insert: "Α" }, { label: "Β", insert: "Β" }, { label: "Γ", insert: "Γ" },
  { label: "Δ", insert: "Δ" }, { label: "Ε", insert: "Ε" }, { label: "Ζ", insert: "Ζ" },
  { label: "Η", insert: "Η" }, { label: "Θ", insert: "Θ" }, { label: "Ι", insert: "Ι" },
  { label: "Κ", insert: "Κ" }, { label: "Λ", insert: "Λ" }, { label: "Μ", insert: "Μ" },
  { label: "Ν", insert: "Ν" }, { label: "Ξ", insert: "Ξ" }, { label: "Ο", insert: "Ο" },
  { label: "Π", insert: "Π" }, { label: "Ρ", insert: "Ρ" }, { label: "Σ", insert: "Σ" },
  { label: "Τ", insert: "Τ" }, { label: "Υ", insert: "Υ" }, { label: "Φ", insert: "Φ" },
  { label: "Χ", insert: "Χ" }, { label: "Ψ", insert: "Ψ" }, { label: "Ω", insert: "Ω" },
];

// 数学符号快捷面板：关系/运算/箭头/集合等，点击直接插入 Unicode 符号
export const OPERATOR_QUICK: { label: string; insert: string }[] = [
  { label: "≤", insert: "≤" }, { label: "≥", insert: "≥" }, { label: "≠", insert: "≠" },
  { label: "≈", insert: "≈" }, { label: "≡", insert: "≡" }, { label: "∝", insert: "∝" },
  { label: "∼", insert: "∼" }, { label: "±", insert: "±" }, { label: "∓", insert: "∓" },
  { label: "×", insert: "×" }, { label: "÷", insert: "÷" }, { label: "·", insert: "·" },
  { label: "+", insert: "+" }, { label: "−", insert: "−" }, { label: "→", insert: "→" },
  { label: "←", insert: "←" }, { label: "↔", insert: "↔" }, { label: "⇒", insert: "⇒" },
  { label: "⇐", insert: "⇐" }, { label: "⇔", insert: "⇔" }, { label: "∈", insert: "∈" },
  { label: "∉", insert: "∉" }, { label: "⊂", insert: "⊂" }, { label: "⊃", insert: "⊃" },
  { label: "⊆", insert: "⊆" }, { label: "⊇", insert: "⊇" }, { label: "∪", insert: "∪" },
  { label: "∩", insert: "∩" }, { label: "∑", insert: "∑" }, { label: "∏", insert: "∏" },
  { label: "∫", insert: "∫" }, { label: "∮", insert: "∮" }, { label: "√", insert: "√" },
  { label: "∞", insert: "∞" }, { label: "∂", insert: "∂" }, { label: "∇", insert: "∇" },
  { label: "∀", insert: "∀" }, { label: "∃", insert: "∃" }, { label: "∅", insert: "∅" },
  { label: "∠", insert: "∠" }, { label: "⊥", insert: "⊥" }, { label: "∥", insert: "∥" },
  { label: "∘", insert: "∘" }, { label: "°", insert: "°" }, { label: "…", insert: "…" },
  { label: "⋯", insert: "⋯" }, { label: "∧", insert: "∧" }, { label: "∨", insert: "∨" },
];

// 传统公式分位置编辑：把公式源码解析成「结构 → 各槽位」的树，每个槽位对应源码中的一个区间，
// 用户在 FormulaDialog 里点某个位置（如求和符号的上面/下面）即可单独输入/替换该处内容。
// 解析出带源码区间（start/end）的结构，供 UI 精确改写源码任意位置。
export interface FormulaSlot {
  // 槽位在源码中的区间 [start, end)：替换该区间的文本即可改这一处内容
  start: number;
  end: number;
  // 展示标签（如"上面""下面""分子""分母""被开方数"）
  label: string;
  // 当前内容
  value: string;
}

export interface FormulaStructure {
  // 结构类型：sum / int / prod / frac / sqrt / sup / sub / lim / left（括号组）
  kind: string;
  // 展示名（如"求和""积分""分数""根号"）
  name: string;
  // 结构符号预览（∑ ∫ √ …）
  symbol: string;
  // 各槽位：顺序即 UI 展示顺序（如求和 = [上面, 下面]）
  slots: FormulaSlot[];
}

// 解析 {…} 包裹内容：返回 { value, start, end }（start 指向 { 后第一个字符，end 指向 } 前）
function parseBraced(src: string, i: number): { value: string; start: number; end: number } | null {
  if (src[i] !== "{") return null;
  const end = src.indexOf("}", i + 1);
  if (end < 0) return null;
  return { value: src.slice(i + 1, end), start: i + 1, end };
}

// 解析 \cmd_{...}^{...} 形式的命令：返回 { name, opt, sub, sup }（均可缺省）
// i 指向反斜杠；opt 处理 [n]（n 次根），sub/sup 处理 _{} 与 ^{}（求和上下限/积分上下限）
interface ParsedCommand {
  name: string;
  body: { value: string; start: number; end: number } | null;
  opt: { value: string; start: number; end: number } | null;
  sub: { value: string; start: number; end: number } | null;
  sup: { value: string; start: number; end: number } | null;
}

function parseCommand(src: string, i: number): ParsedCommand | null {
  if (src[i] !== "\\") return null;
  let j = i + 1;
  while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
  const name = src.slice(i + 1, j);
  if (!name) return null;
  let opt: ParsedCommand["opt"] = null;
  let sub: ParsedCommand["sub"] = null;
  let sup: ParsedCommand["sup"] = null;
  let k = j;
  // 可选 [n]
  if (src[k] === "[") {
    const close = src.indexOf("]", k + 1);
    if (close >= 0) {
      opt = { value: src.slice(k + 1, close), start: k + 1, end: close };
      k = close + 1;
    }
  }
  // _{} 与 ^{}（任意顺序，各最多一次）
  for (let pass = 0; pass < 2; pass++) {
    if (src[k] === "_") {
      const b = parseBraced(src, k + 1);
      if (b) { sub = b; k = b.end + 1; continue; }
    }
    if (src[k] === "^") {
      const b = parseBraced(src, k + 1);
      if (b) { sup = b; k = b.end + 1; continue; }
    }
    break;
  }
  // 主体 {}（分数两个、根号一个、括号一对）
  const body = parseBraced(src, k);
  if (body) k = body.end + 1;
  return { name, body, opt, sub, sup };
}

// 把公式源码解析为可编辑结构列表（传统公式：求和/积分/分数/根号/上下标/极限/括号）。
// 覆盖常见写法；无法识别的部分忽略（仍可整体编辑源码）。
export function parseFormulaStructures(src: string): FormulaStructure[] {
  const out: FormulaStructure[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      const c = parseCommand(src, i);
      if (!c) { i++; continue; }
      const consumed = c.body ? c.body.end + 1 : c.opt ? c.opt.end + 1 : c.sub ? c.sub.end + 1 : c.sup ? c.sup.end + 1 : 0;
      if (c.name === "frac" && c.body) {
        // 分数：\frac{a}{b} → 分子/分母两个槽位（第二个 {} 即分母）
        const second = parseBraced(src, c.body.end + 1);
        const slots: FormulaSlot[] = [
          { start: c.body.start, end: c.body.end, label: "分子", value: c.body.value },
        ];
        let next = c.body.end + 1;
        if (second) {
          slots.push({ start: second.start, end: second.end, label: "分母", value: second.value });
          next = second.end + 1;
        }
        out.push({ kind: "frac", name: "分数", symbol: "a⁄b", slots });
        i = next;
        continue;
      }
      if (c.name === "sqrt") {
        // 根号：\sqrt[n]{x} → 根指数（可选）+ 被开方数
        const slots: FormulaSlot[] = [];
        if (c.opt) slots.push({ start: c.opt.start, end: c.opt.end, label: "根指数", value: c.opt.value });
        if (c.body) slots.push({ start: c.body.start, end: c.body.end, label: "被开方数", value: c.body.value });
        if (slots.length > 0) out.push({ kind: "sqrt", name: "根号", symbol: "√", slots });
        i = c.body ? c.body.end + 1 : consumed || c.opt?.end ? (c.opt!.end + 1) : i + 1;
        continue;
      }
      if (c.name === "sum" || c.name === "int" || c.name === "prod") {
        // 求和/积分/连乘：上限（sup）+ 下限（sub）+ 被积/被求项（body）
        const labels: Record<string, { name: string; symbol: string }> = {
          sum: { name: "求和", symbol: "∑" },
          int: { name: "积分", symbol: "∫" },
          prod: { name: "连乘", symbol: "∏" },
        };
        const meta = labels[c.name];
        const slots: FormulaSlot[] = [];
        if (c.sup) slots.push({ start: c.sup.start, end: c.sup.end, label: "上面", value: c.sup.value });
        if (c.sub) slots.push({ start: c.sub.start, end: c.sub.end, label: "下面", value: c.sub.value });
        if (c.body) slots.push({ start: c.body.start, end: c.body.end, label: c.name === "int" ? "被积函数" : "求和项", value: c.body.value });
        out.push({ kind: c.name, name: meta.name, symbol: meta.symbol, slots });
        i = c.body ? c.body.end + 1 : c.sup ? c.sup.end + 1 : c.sub ? c.sub.end + 1 : i + 1;
        continue;
      }
      if (c.name === "lim") {
        // 极限：趋近条件（sub）
        const slots: FormulaSlot[] = [];
        if (c.sub) slots.push({ start: c.sub.start, end: c.sub.end, label: "趋近条件", value: c.sub.value });
        out.push({ kind: "lim", name: "极限", symbol: "lim", slots });
        i = c.sub ? c.sub.end + 1 : c.body ? c.body.end + 1 : i + 1;
        continue;
      }
      if (c.name === "left" || c.name === "right") {
        // 括号组：\left( x \right) → 去标记；\left\{ → 大括号
        // 括号对整体不拆槽位（内容在 \right 的 body 里），跳过继续扫描内部
        i++;
        continue;
      }
      // 其他命令：跳过命令本身，继续扫描（保留其子内容可被后续结构解析）
      i = consumed > 0 ? consumed : i + 1;
      continue;
    }
    // 裸上标/下标：x^{n} / x_{i}（在命令外单独出现）
    if ((ch === "^" || ch === "_") && src[i + 1] === "{") {
      const b = parseBraced(src, i + 1);
      if (b) {
        out.push({
          kind: ch === "^" ? "sup" : "sub",
          name: ch === "^" ? "上标" : "下标",
          symbol: ch === "^" ? "xⁿ" : "xᵢ",
          slots: [{ start: b.start, end: b.end, label: ch === "^" ? "上标内容" : "下标内容", value: b.value }],
        });
        i = b.end + 1;
        continue;
      }
    }
    // 单字符上下标（H_2O、x^2 等无花括号写法）：同样作为可编辑槽位
    if ((ch === "^" || ch === "_") && i + 1 < src.length) {
      const nc = src[i + 1];
      if (nc !== "{" && nc !== "}" && nc !== "\\" && nc !== " ") {
        out.push({
          kind: ch === "^" ? "sup" : "sub",
          name: ch === "^" ? "上标" : "下标",
          symbol: ch === "^" ? "xⁿ" : "xᵢ",
          slots: [{ start: i + 1, end: i + 2, label: ch === "^" ? "上标内容" : "下标内容", value: nc }],
        });
        i += 2;
        continue;
      }
    }
    i++;
  }
  return out;
}

// 按结构槽位改写源码：把 [start, end) 区间替换为新文本（用于分位置编辑写回）
export function applySlotEdit(src: string, start: number, end: number, value: string): string {
  if (start < 0 || end < start || end > src.length) return src;
  return src.slice(0, start) + value + src.slice(end);
}
