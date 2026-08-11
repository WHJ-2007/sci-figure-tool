import { DollarRecognizer } from "@smartupcorp/onedollar-unistroke-recognizer";

// 手写形状识别（$1 Unistroke Recognizer——业界标准单笔手势识别算法，非启发式死记）：
// 把用户画笔自由绘制的点列归一化（重采样/缩放/平移）后与预置手势模板匹配，
// 按距离打分。注册 6 个模板：直线、圆、椭圆、方形、箭头、折点箭头（弯箭头），
// 命中后替换为对应规整元素；识别不出则保留手写笔迹。
//
// 注意：库内置 ARROW_GESTURE 模板点列含大量抖动，对真实手写识别得分极低，故全部使用
// 自定义干净模板；识别用普通模式（Protractor 对方向敏感形状的旋转搜索反而误伤）。
// 模板都用「左上角起点」生成，$1 会做平移归一化，方向/大小由识别结果回填。

function linePts(a: { x: number; y: number }, b: { x: number; y: number }, n = 10): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return pts;
}

function circlePts(cx: number, cy: number, rx: number, ry: number, n = 16): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

function rectPts(x: number, y: number, w: number, h: number): { x: number; y: number }[] {
  // 顺时针一笔画矩形：顶边 → 右边 → 底边 → 左边（回到起点附近）
  return [...linePts({ x, y }, { x: x + w, y }), ...linePts({ x: x + w, y }, { x: x + w, y: y + h }, 4), ...linePts({ x: x + w, y: y + h }, { x, y: y + h }, 4), ...linePts({ x, y: y + h }, { x, y }, 4)];
}

const T = {
  line: linePts({ x: 0, y: 50 }, { x: 200, y: 50 }),
  circle: circlePts(100, 100, 60, 60),
  ellipse: circlePts(100, 100, 80, 45),
  square: rectPts(20, 20, 160, 160),
  arrow: [
    ...linePts({ x: 0, y: 50 }, { x: 150, y: 50 }), // 杆
    { x: 200, y: 50 }, // 尖端
    { x: 180, y: 35 }, // 上翼
    { x: 178, y: 62 }, // 下翼（回勾）
  ],
  "bent-arrow": [
    ...linePts({ x: 0, y: 50 }, { x: 120, y: 50 }), // 第一段水平
    ...linePts({ x: 120, y: 50 }, { x: 200, y: 120 }, 4), // 折向第二段
    { x: 220, y: 140 }, // 尖端
    { x: 200, y: 130 }, // 上翼
    { x: 200, y: 152 }, // 下翼（回勾）
  ],
  // 折线（无箭头）：两段直线带折点，末尾不回勾（与 bent-arrow 区分——用户画"有折点的直线"）
  "bent-line": [
    ...linePts({ x: 0, y: 50 }, { x: 120, y: 50 }, 6), // 第一段水平
    ...linePts({ x: 120, y: 50 }, { x: 200, y: 120 }, 6), // 折向第二段
  ],
  // 平滑折线：水平段 + 四分之一圆弧平滑过渡 + 斜线段（折点处圆滑过渡 → smooth 折点）
  "smooth-bent": [
    ...linePts({ x: 0, y: 50 }, { x: 110, y: 50 }, 5), // 第一段水平
    ...Array.from({ length: 9 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); // 圆心 (110,110) 半径 60：正上 → 正右
      return { x: 110 + Math.cos(a) * 60, y: 110 + Math.sin(a) * 60 };
    }),
    ...linePts({ x: 170, y: 110 }, { x: 220, y: 150 }, 5), // 斜向第二段
  ],
};

const recognizer = new DollarRecognizer([]);
for (const [name, pts] of Object.entries(T)) recognizer.addGesture(name, pts);

// 手写识别结果：类型 + 几何参数（世界坐标，决定方向/大小/位置）
export type RecognizedShapeType = "arrow" | "line" | "circle" | "ellipse" | "square" | "bent-arrow" | "bent-line" | "smooth-bent";
export interface RecognizedShape {
  type: RecognizedShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  // 折点（折线/平滑折线/折点箭头）：相对起点的折点（与 ArrowElement.midPoints 同构，
  // smooth=true 的折点为平滑折点 → Catmull-Rom 平滑穿过）
  midPoints?: { x: number; y: number; smooth?: boolean }[];
}

function boundsOf(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// 点到线段的距离（RDP 拐点提取用）
function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer–Douglas–Peucker 提取拐点：迭代找离首尾连线最远的点，超过阈值保留并递归两侧。
// 返回按顺序排列的拐点（相对起点偏移，与 ArrowElement.midPoints 同构）。
// 用于折线（bent-line）与平滑折线（smooth-bent）——可提取多个拐点（如 Z 形折线两个拐点）
function cornerPoints(points: { x: number; y: number }[], eps = 10): { x: number; y: number }[] {
  const first = points[0];
  const result: { x: number; y: number }[] = [];
  const rdp = (list: { x: number; y: number }[], depth: number) => {
    if (depth > 8 || list.length < 3) return;
    const a = list[0], b = list[list.length - 1];
    let maxD = -1, idx = -1;
    for (let i = 1; i < list.length - 1; i++) {
      const d = distToSegment(list[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      rdp(list.slice(0, idx + 1), depth + 1);
      result.push({ x: list[idx].x - first.x, y: list[idx].y - first.y });
      rdp(list.slice(idx), depth + 1);
    }
  };
  rdp(points, 0);
  return result;
}

// 末端"箭头翼"检测：折点箭头（bent-arrow）的末尾有尖端 + 上下翼（回勾），
// 翼点会明显偏离末段方向线；而 Z 形等折线（bent-line）的最后一段是直段，各点都在方向线上。
// 用几何判据把 $1 对 Z 形折线的误判（模板翼结构被匹配上）纠正回折线。
function hasArrowWing(points: { x: number; y: number }[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const last = points[n - 1];
  const prev = points[n - 2];
  const dx = last.x - prev.x, dy = last.y - prev.y;
  const seg = Math.hypot(dx, dy);
  if (seg < 1) return false;
  // 检查尖端前的几个点（倒数第 2..6 个）相对末段方向线的最大垂直偏移
  let maxDev = 0;
  for (let i = Math.max(0, n - 6); i < n - 1; i++) {
    const p = points[i];
    const t = ((p.x - prev.x) * dx + (p.y - prev.y) * dy) / (seg * seg);
    const px = prev.x + t * dx, py = prev.y + t * dy;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d > maxDev) maxDev = d;
  }
  // 翼点相对末段应有明显偏移（绝对 >8px 或相对末段 >25%）
  return maxDev > Math.max(8, seg * 0.25);
}

// 整条点列的最大方向突变角（弧度）：计算相邻两点方向角的差，取最大者。
// 圆滑曲线/平滑折线（圆弧过渡）每步方向变化小 → 突变角小；
// 尖锐折线（直角/锐角拐点）在拐点处方向突变大 → 突变角大。
// 注意必须在 recognize() 之前用原始点列计算（recognize 会原地重采样，重采样后尖角被抹平）。
// 重合点（零长度段）的方向角无意义（atan2(0,0)=0）会产生假突变，必须跳过。
// 用于区分"平滑折点曲线"（smooth-bent）与"尖锐折线"（bent-line），修正 $1 对平滑曲线的误判。
function maxTurnAngle(points: { x: number; y: number }[]): number {
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dx1 = points[i].x - points[i - 1].x;
    const dy1 = points[i].y - points[i - 1].y;
    const dx2 = points[i + 1].x - points[i].x;
    const dy2 = points[i + 1].y - points[i].y;
    if (Math.hypot(dx1, dy1) < 1 || Math.hypot(dx2, dy2) < 1) continue;
    const a = Math.atan2(dy1, dx1);
    const b = Math.atan2(dy2, dx2);
    let d = Math.abs(a - b);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > max) max = d;
  }
  return max;
}

// 平滑 vs 尖锐折点判据阈值：最大方向突变角 < 30°（π/6）视为圆滑过渡（平滑折点曲线），
// ≥ 30° 视为尖角折线。阈值需低于"水平+45°斜线折线"的突变角（≈45°），使普通折线保持尖锐
const SMOOTH_TURN = Math.PI / 6;

// 识别手写点列构成的形状；命中返回规整元素参数（方向/大小与手写一致）。
// 阈值太低会误判乱涂为形状，太高则漏检。直线等退化输入库会返回 NaN 分数，须显式排除。
// minScore 可选（缺省 0.5）：顿笔预览用更严格阈值（如 0.6）避免"画到一半就被预测"，松手成图仍用 0.5 宽松识别
export function recognizeShape(points: { x: number; y: number }[], minScore = 0.5): RecognizedShape | null {
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const len = Math.hypot(last.x - first.x, last.y - first.y);
  const { minX, maxX, minY, maxY } = boundsOf(points);
  const cw = maxX - minX, ch = maxY - minY;
  // 末端箭头翼检测必须用原始点列：recognize() 会原地重采样（均匀分布），
  // 重采样后末段各点都在直线上，翼结构消失，检测会失效
  const hasWing = hasArrowWing(points);
  // 平滑 vs 尖锐判据同样必须用原始点列（见 maxTurnAngle 注释）
  const turn = maxTurnAngle(points);
  // 闭合形状（圆/椭圆/方形）：首末点接近，长度按包围盒尺寸判定；
  // 开放形状（箭头/折点箭头/直线）：长度按首末点距离判定
  const isClosed = len < Math.max(cw, ch) * 0.35;
  if (isClosed ? Math.max(cw, ch) < 24 : len < 24) return null;
  // 直线度判别：纯直线（各点到首尾连线最大偏移很小）→ 直线（$1 的 line 模板可能高分命中别的形状，几何排除优先）
  const maxDev = Math.max(
    ...points.map((p) => {
      const t = Math.max(0, Math.min(1, ((p.x - first.x) * (last.x - first.x) + (p.y - first.y) * (last.y - first.y)) / (len * len)));
      const px = first.x + (last.x - first.x) * t;
      const py = first.y + (last.y - first.y) * t;
      return Math.hypot(p.x - px, p.y - py);
    })
  );
  if (len > 0 && maxDev / len < 0.05) {
    return { type: "line", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y };
  }
  const results = recognizer.recognize(points, false);
  // 注意：纯直线等退化输入会让识别器对部分模板（尤其 line）返回 NaN 分数且常排第一，
  // 必须跳过无效/低分结果，取第一个有效命中（score ∈ [minScore, 1]）
  const best = results.find((r) => r.name !== "line" && Number.isFinite(r.score) && r.score >= minScore);
  if (!best) return null;
  // 闭合形状（圆/椭圆/方形）用包围盒定位；开放形状（箭头/折点箭头）用首末点定方向。
  // 关键：$1 对明显未封闭的开口弧（如 270° 弧）/缺边方形也可能给 circle/ellipse/square 高分，
  // 必须用 isClosed 几何校验——首末点不接近（未闭合）就绝不识别为封闭图形，落入下方开放形状分支
  if ((best.name === "circle" || best.name === "ellipse" || best.name === "square") && isClosed) {
    return { type: best.name, x: minX, y: minY, width: cw, height: ch };
  }
  if (best.name === "bent-arrow") {
    // 折点箭头：折点取首点到末点之间偏移最大的中间点（相对起点）
    // 几何判据：Z 形等多段折线末端无"回勾翼"，$1 却可能高分匹配 bent-arrow 模板 → 降级为折线。
    // hasWing 在 recognize 前用原始点计算（recognize 会原地重采样使翼消失）
    if (!hasWing) {
      // 按方向突变角区分：圆滑过渡 → 平滑折点曲线；尖角 → 折线
      const smooth = turn < SMOOTH_TURN;
      const mids = cornerPoints(points).map((c) => (smooth ? { ...c, smooth: true } : c));
      return { type: smooth ? "smooth-bent" : "bent-line", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y, midPoints: mids };
    }
    let mid: { x: number; y: number } | null = null;
    let bestDev = -1;
    for (const p of points) {
      const t = Math.max(0, Math.min(1, ((p.x - first.x) * (last.x - first.x) + (p.y - first.y) * (last.y - first.y)) / (len * len)));
      const px = first.x + (last.x - first.x) * t;
      const py = first.y + (last.y - first.y) * t;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d > bestDev) { bestDev = d; mid = { x: p.x - first.x, y: p.y - first.y }; }
    }
    return { type: "bent-arrow", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y, midPoints: mid ? [mid] : [] };
  }
  if (best.name === "bent-line" || best.name === "smooth-bent") {
    // 折线（无箭头）：RDP 提取全部拐点（可多个，如 Z 形折线两个拐点）；
    // 平滑 vs 尖锐由几何判据（方向突变角）决定：$1 模板名不可靠（平滑曲线常被误判成 arrow/bent-line），
    // 突变角小（圆滑过渡）→ smooth-bent（Catmull-Rom 平滑穿过），突变角大（尖角）→ bent-line
    const smooth = turn < SMOOTH_TURN;
    const mids = cornerPoints(points).map((c) => (smooth ? { ...c, smooth: true } : c));
    return { type: smooth ? "smooth-bent" : "bent-line", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y, midPoints: mids };
  }
  // 夸张曲线判据：$1 的 arrow 模板对"一条弯曲线"（S 形/大弧/波浪）得分可能最高，
  // 但真实箭头末端有"回勾翼"（hasWing），曲线没有；且弯曲度明显（各点到首尾连线最大偏移比例大）。
  // 无翼 + 明显弯曲 → 识别为折线/平滑折点曲线（由突变角决定），不再误生成无折点直箭头
  if (!hasWing && len > 0 && maxDev / len > 0.05) {
    const smooth = turn < SMOOTH_TURN;
    const mids = cornerPoints(points).map((c) => (smooth ? { ...c, smooth: true } : c));
    return { type: smooth ? "smooth-bent" : "bent-line", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y, midPoints: mids };
  }
  return { type: "arrow", x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y };
}

// 兼容旧接口：仅识别箭头（返回 null 表示非箭头）
export function recognizeArrow(points: { x: number; y: number }[]): { x: number; y: number; width: number; height: number; strokeWidth: number } | null {
  const r = recognizeShape(points);
  if (!r || r.type !== "arrow") return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, strokeWidth: 2 };
}
