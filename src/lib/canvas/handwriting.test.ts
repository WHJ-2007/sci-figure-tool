import { describe, it, expect } from "vitest";
import { ARROW_GESTURE } from "@smartupcorp/onedollar-unistroke-recognizer";
import { recognizeArrow } from "./handwriting";

describe("recognizeArrow（$1 手写箭头识别）", () => {
  it("不识别过短点列（<24px 视为点按/墨迹）", () => {
    expect(recognizeArrow([{ x: 100, y: 100 }, { x: 105, y: 103 }])).toBeNull();
  });

  it("纯直线不误判为箭头（几何直线度排除）", () => {
    const line = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 10, y: 100 }));
    expect(recognizeArrow(line)).toBeNull();
  });

  it("规范箭头形状（$1 arrow 模板点列平移后）识别命中并返回同方向/大小参数", () => {
    // 用 $1 库内置 arrow 模板的点列整体平移 300px，模拟用户手写的右向箭头
    const pts = ARROW_GESTURE.points.map((p) => ({ x: p.x + 300, y: p.y + 100 }));
    const res = recognizeArrow(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    // 起点 = 首点、终点 = 末点：方向/大小与手写一致
    expect(res.x).toBeCloseTo(pts[0].x, 0);
    expect(res.y).toBeCloseTo(pts[0].y, 0);
    expect(res.width).toBeCloseTo(pts[pts.length - 1].x - pts[0].x, 0);
    expect(res.height).toBeCloseTo(pts[pts.length - 1].y - pts[0].y, 0);
  });
});
