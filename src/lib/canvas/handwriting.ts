import { DollarRecognizer, ARROW_GESTURE } from "@smartupcorp/onedollar-unistroke-recognizer";

// 手写形状识别（$1 Unistroke Recognizer——业界标准单笔手势识别算法，非启发式死记）：
// 把用户画笔自由绘制的点列归一化（重采样/缩放/平移）后与预置手势模板匹配，
// 按旋转不变距离打分。这里只注册 arrow 模板：手写箭头被识别为箭头 →
// 用相同方向/大小/粗细的规整 ArrowElement 替换；识别不出则保留手写笔迹。
const recognizer = new DollarRecognizer([ARROW_GESTURE]);

// 手写箭头识别结果：起点/终点（世界坐标，决定方向与大小）、线宽（决定粗细）
export interface RecognizedArrow {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth: number;
}

// 识别手写点列是否构成箭头；命中返回规整箭头参数（起点 = 首点，终点 = 末点，
// 方向/大小与手写一致，线宽保留画笔粗细）；阈值太低会误判乱涂为箭头，太高则漏检
export function recognizeArrow(points: { x: number; y: number }[]): RecognizedArrow | null {
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const len = Math.hypot(last.x - first.x, last.y - first.y);
  // 过短/过短的涂鸦不识别（不足 24px 视为点按/墨迹）
  if (len < 24) return null;
  // 直线度判别：纯直线（各点到首尾连线的最大偏移很小）是"线条"不是箭头——
  // $1 的 arrow 模板形似"横杆+尾部 V"，纯直线也可能高分命中，必须用几何排除
  const maxDev = Math.max(
    ...points.map((p) => {
      const t = Math.max(0, Math.min(1, ((p.x - first.x) * (last.x - first.x) + (p.y - first.y) * (last.y - first.y)) / (len * len)));
      const px = first.x + (last.x - first.x) * t;
      const py = first.y + (last.y - first.y) * t;
      return Math.hypot(p.x - px, p.y - py);
    })
  );
  // 箭头头部 V 相对线长的偏离比例（≈ 头部张开幅度），太小 = 直线/线条
  if (len > 0 && maxDev / len < 0.06) return null;
  const [best] = recognizer.recognize(points, true);
  // score ∈ [0,1]，越大越像模板；0.55 以上视为箭头（手写允许一定变形）
  if (!best || best.name !== "arrow" || best.score < 0.55) return null;
  return {
    x: first.x,
    y: first.y,
    width: last.x - first.x,
    height: last.y - first.y,
    strokeWidth: 2,
  };
}
