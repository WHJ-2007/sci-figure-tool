import { describe, it, expect } from "vitest";
import { ARROW_GESTURE } from "@smartupcorp/onedollar-unistroke-recognizer";
import { recognizeShape, recognizeArrow } from "./handwriting";

describe("recognizeShape（$1 手写形状识别）", () => {
  it("不识别过短点列（<24px 视为点按/墨迹）", () => {
    expect(recognizeShape([{ x: 100, y: 100 }, { x: 105, y: 103 }])).toBeNull();
  });

  it("纯直线识别为 line（不再误判为箭头）", () => {
    const line = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 10, y: 100 }));
    const res = recognizeShape(line);
    expect(res).not.toBeNull();
    expect(res!.type).toBe("line");
    // 兼容旧接口：recognizeArrow 对直线返回 null
    expect(recognizeArrow(line)).toBeNull();
  });

  it("规范箭头形状（干净箭头点列平移后）识别命中并返回同方向/大小参数", () => {
    // 干净箭头（杆 + 尖端 + 上下翼一笔画），整体平移 300px 模拟用户手写的右向箭头
    const cleanArrow = [
      ...[...Array(11)].map((_, i) => ({ x: 50 + i * 15, y: 100 })),
      { x: 205, y: 100 },
      { x: 190, y: 85 },
      { x: 188, y: 112 },
    ];
    const pts = cleanArrow.map((p) => ({ x: p.x + 300, y: p.y + 100 }));
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("arrow");
    // 起点 = 首点、终点 = 末点：方向/大小与手写一致
    expect(res.x).toBeCloseTo(pts[0].x, 0);
    expect(res.y).toBeCloseTo(pts[0].y, 0);
    expect(res.width).toBeCloseTo(pts[pts.length - 1].x - pts[0].x, 0);
    expect(res.height).toBeCloseTo(pts[pts.length - 1].y - pts[0].y, 0);
  });

  it("一笔画圆识别为 circle（包围盒定位）", () => {
    const pts = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return { x: 400 + Math.cos(a) * 60, y: 300 + Math.sin(a) * 60 };
    });
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("circle");
    expect(res.width).toBeGreaterThan(100);
    expect(res.height).toBeGreaterThan(100);
  });

  it("一笔画方形识别为 square", () => {
    const pts = [
      ...Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 20, y: 100 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 200, y: 100 + i * 20 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 200 - i * 20, y: 200 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 100, y: 200 - i * 20 })),
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("square");
    expect(res.width).toBeCloseTo(res.height, -1);
  });

  it("折线 + 箭头头识别为 bent-arrow（带折点）", () => {
    const pts = [
      ...Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 15, y: 100 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 190 + i * 12, y: 100 + i * 14 })),
      { x: 252, y: 170 },
      { x: 240, y: 152 },
      { x: 238, y: 176 },
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("bent-arrow");
    expect(res.midPoints?.length).toBeGreaterThan(0);
  });

  it("折线（无箭头）识别为 bent-line：带拐点且无 smooth 标记", () => {
    // 干净折线：水平段 + 斜向段，末尾不回勾（无箭头翼）
    const pts = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 14, y: 100 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 205 + i * 10, y: 100 + i * 12 })),
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("bent-line");
    expect(res.midPoints?.length).toBeGreaterThan(0);
    expect(res.midPoints!.some((m) => m.smooth)).toBe(false);
  });

  it("Z 形折线识别为 bent-line：提取多个拐点", () => {
    const pts = [
      ...Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 14, y: 100 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 200, y: 100 + i * 14 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 200 - i * 14, y: 200 })),
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("bent-line");
    expect(res.midPoints?.length).toBeGreaterThanOrEqual(2);
  });

  it("平滑折线识别为 smooth-bent：拐点带 smooth 标记（Catmull-Rom 平滑穿过）", () => {
    // 平滑折线：水平段 + 圆弧过渡 + 竖直段（首尾连续衔接，全程方向渐变无突变角 → smooth）
    const pts = [
      ...Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 8, y: 100 })),
      ...Array.from({ length: 9 }, (_, i) => {
        const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); // 圆心 (140,160) 半径 60：正上 → 正右
        return { x: 140 + Math.cos(a) * 60, y: 160 + Math.sin(a) * 60 };
      }),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 200, y: 160 + i * 10 })),
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("smooth-bent");
    expect(res.midPoints?.length).toBeGreaterThan(0);
    expect(res.midPoints!.some((m) => m.smooth)).toBe(true);
  });

  it("S 形夸张曲线识别为 smooth-bent（不再误判为无折点直箭头）", () => {
    // S 形曲线：左→右，先下弯再上弯（$1 的 arrow 模板对这类曲线得分可能最高，几何判据纠正）
    const pts = Array.from({ length: 40 }, (_, i) => {
      const t = i / 39;
      return { x: 100 + t * 300, y: 150 + Math.sin(t * Math.PI * 2) * 60 };
    });
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("smooth-bent");
    expect(res.midPoints?.length).toBeGreaterThan(0);
    expect(res.midPoints!.every((m) => m.smooth)).toBe(true);
  });

  it("单弯大弧识别为 smooth-bent（弯曲明显但无箭头翼，不是直箭头）", () => {
    const pts = Array.from({ length: 30 }, (_, i) => {
      const t = i / 29;
      return { x: 100 + t * 300, y: 150 + Math.sin(t * Math.PI) * 100 };
    });
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("smooth-bent");
    expect(res.midPoints?.length).toBeGreaterThan(0);
  });

  it("真箭头（带回勾翼）仍识别为 arrow，不受曲线判据误伤", () => {
    const pts = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 14, y: 100 })),
      { x: 220, y: 100 },
      { x: 200, y: 86 },
      { x: 198, y: 112 },
    ];
    const res = recognizeShape(pts);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.type).toBe("arrow");
    expect(res.midPoints?.length ?? 0).toBe(0);
  });
});
