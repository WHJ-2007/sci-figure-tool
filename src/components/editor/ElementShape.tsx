import type { CanvasElement } from "@/lib/canvas/types";
import { shapePoints, arrowHeadPoints, arrowHeadSize, curveControl, arrowPathD, arrowPoints } from "@/lib/canvas/geometry";
import { contrastTextColor, elementTransform } from "@/lib/canvas/elements";
import { latexToUnicode } from "@/lib/canvas/formula";

export default function ElementShape({ e, locked = false, ghost = false, plain = false }: { e: CanvasElement; locked?: boolean; ghost?: boolean; plain?: boolean }) {
  const t = elementTransform(e);
  // 悬浮动效包在变换组外层（CSS transform 会覆盖 transform 属性，不能共用同一 g）：
  // 锁定元素（AI 编辑中）、拖动中（ghost，鼠标悬停在移动的元素上）与 plain（绘制中的画笔预览）
  // 不参与悬浮动效——拖动中元素保持原尺寸，不因悬停放大
  // 细线元素（箭头/折线/笔迹/曲线）自带透明加宽命中层（strokeWidth 12），hover 判定基于加宽区域，
  // 放大 5% 的位移远小于命中层宽度 → 边界不再反复抖动，可安全恢复"放大 + 高亮"
  return (
    <g data-element-id={e.id} style={ghost ? { opacity: 0.4 } : undefined} filter={e.shadow ? `url(#sh-${e.id})` : undefined}>
      <g className={locked || plain || ghost ? undefined : "el-hover"}>
        <g transform={t}>{renderBody(e)}</g>
      </g>
    </g>
  );
}

function renderBody(e: CanvasElement): React.ReactNode {
  // 边框/内部/整体三套独立透明度：填充、边框各自与整体 opacity 相乘；
  // 旧元素（无独立透明度字段）不输出 fill/stroke-opacity（与导出一致，保持兼容）
  const fillO = e.opacity * (e.fillOpacity ?? 1);
  const strokeO = e.opacity * (e.strokeOpacity ?? 1);
  const fillOpacityAttr = e.fillOpacity !== undefined ? fillO : undefined;
  const strokeOpacityAttr = e.strokeOpacity !== undefined ? strokeO : undefined;
  const dashAttr = e.dash ? e.dash.join(" ") : undefined;
  switch (e.type) {
    case "rect":
      return <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />;
    case "ellipse":
      return (
        <ellipse cx={e.x + e.width / 2} cy={e.y + e.height / 2} rx={e.width / 2} ry={e.height / 2} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />
      );
    case "triangle":
    case "diamond":
    case "hexagon":
    case "star":
    case "cross":
      return <polygon points={pointsToString(shapePoints(e.type, e))} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />;
    case "donut": {
      // 圆环：外圆弧 + 内孔弧双 path，fillRule=evenodd 挖空（内孔 = 0.65 缩放椭圆）
      const rx = e.width / 2;
      const ry = e.height / 2;
      const cx = e.x + rx;
      const cy = e.y + ry;
      const irx = rx * 0.65;
      const iry = ry * 0.65;
      const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} M ${cx - irx} ${cy} A ${irx} ${iry} 0 1 0 ${cx + irx} ${cy} A ${irx} ${iry} 0 1 0 ${cx - irx} ${cy}`;
      return <path d={d} fillRule="evenodd" fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />;
    }
    case "half": {
      // 半圆（上半圆）：起点左端 → 上半弧 → 闭合弦
      const rx = e.width / 2;
      const ry = e.height / 2;
      const cy = e.y + ry;
      const d = `M ${e.x} ${cy} A ${rx} ${ry} 0 0 1 ${e.x + e.width} ${cy} Z`;
      return <path d={d} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />;
    }
    case "arrow": {
      const x2 = e.x + e.width;
      const y2 = e.y + e.height;
      // 带折点的箭头：折线路径 + 箭头方向取末段（起点→折点…→终点）
      if ((e.midPoints?.length ?? 0) > 0) {
        const pts = arrowPoints(e);
        const ptsStr = pointsToString(pts);
        // 含平滑折点 → Catmull-Rom 曲线路径（平滑穿过折点）；全尖锐 → 折线
        const hasSmooth = e.midPoints!.some((m) => m.smooth);
        const d = arrowPathD(pts);
        const heads = arrowHeadPolygons(e, pts);
        if (hasSmooth) {
          return (
            <g>
              <path d={d} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} strokeLinejoin="round" />
              {heads.map((h, i) => <polygon key={i} points={h} fill={e.stroke} fillOpacity={strokeOpacityAttr} />)}
              {/* 透明加宽命中层：细线难点，12px 宽透明描边扩大点击范围 */}
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" pointerEvents="all" />
            </g>
          );
        }
        return (
          <g>
            <polyline points={ptsStr} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} strokeLinejoin="round" />
            {heads.map((h, i) => <polygon key={i} points={h} fill={e.stroke} fillOpacity={strokeOpacityAttr} />)}
            {/* 透明加宽命中层：细线难点，12px 宽透明描边扩大点击范围 */}
            <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" pointerEvents="all" />
          </g>
        );
      }
      const heads = arrowHeadPolygons(e, [
        { x: e.x, y: e.y },
        { x: x2, y: y2 },
      ]);
      return (
        <g>
          <line x1={e.x} y1={e.y} x2={x2} y2={y2} stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} />
          {heads.map((h, i) => <polygon key={i} points={h} fill={e.stroke} fillOpacity={strokeOpacityAttr} />)}
          <line x1={e.x} y1={e.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} strokeLinecap="round" pointerEvents="all" />
        </g>
      );
    }
    case "polyline": {
      const last = e.points[e.points.length - 1];
      const prev = e.points[e.points.length - 2] ?? e.points[0];
      const ptsStr = pointsToString(e.points);
      return (
        <g>
          <polyline points={ptsStr} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} />
          {e.arrow !== false && (
            <polygon points={pointsToString(arrowHeadPoints(prev.x, prev.y, last.x, last.y, arrowHeadSize(e.strokeWidth)))} fill={e.stroke} fillOpacity={strokeOpacityAttr} />
          )}
          {/* 透明加宽命中层：细线难点，12px 宽透明描边扩大 hover/点击范围（防放大边缘抖动） */}
          <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" pointerEvents="all" />
        </g>
      );
    }
    case "pen": {
      // 画笔手写笔迹：连续点列 → 圆头/圆角平滑描边（自由手绘质感）
      const ptsStr = pointsToString(e.points);
      return (
        <g>
          <polyline
            points={ptsStr}
            fill="none"
            stroke={e.stroke}
            strokeWidth={e.strokeWidth}
            strokeDasharray={dashAttr}
            strokeOpacity={strokeOpacityAttr}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 透明加宽命中层：细线难点，12px 宽透明描边扩大 hover/点击范围（防放大边缘抖动） */}
          <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" pointerEvents="all" />
        </g>
      );
    }
    case "curve": {
      const c = curveControl(e);
      const d = `M ${e.x} ${e.y} Q ${c.x} ${c.y} ${e.x + e.width} ${e.y + e.height}`;
      return (
        <g>
          <path d={d} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} />
          {/* 透明加宽命中层：细线难点，12px 宽透明描边扩大 hover/点击范围（防放大边缘抖动） */}
          <path d={d} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" pointerEvents="all" />
        </g>
      );
    }
    case "sector": {
      const r = e.radius;
      const sx = e.x + r * Math.cos(e.startAngle);
      const sy = e.y + r * Math.sin(e.startAngle);
      const ex = e.x + r * Math.cos(e.endAngle);
      const ey = e.y + r * Math.sin(e.endAngle);
      const d = e.endAngle - e.startAngle;
      // sweep 恒为 1（角度增大方向）：跨 0 回绕（endAngle < startAngle）时实际扫过 2π+d，
      // 大弧条件是 d > π（正扫）或 d ∈ (-π, 0)（回绕且缺口小于 π），与 angleInSector 语义一致
      const largeArc = d > Math.PI || (d < 0 && d > -Math.PI) ? 1 : 0;
      // 空心扇形（饼图环形）：外弧 + 内孔弧反向闭合（evenodd 挖孔，与 donut 一致）
      if (e.innerRadius && e.innerRadius > 0) {
        const ir = e.innerRadius;
        const isx = e.x + ir * Math.cos(e.startAngle);
        const isy = e.y + ir * Math.sin(e.startAngle);
        const iex = e.x + ir * Math.cos(e.endAngle);
        const iey = e.y + ir * Math.sin(e.endAngle);
        const dd = `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} L ${iex} ${iey} A ${ir} ${ir} 0 ${largeArc} 0 ${isx} ${isy} Z`;
        return <path d={dd} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />;
      }
      return (
        <path d={`M ${e.x} ${e.y} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />
      );
    }
    case "text": {
      const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const tx = e.align === "left" ? e.x : e.align === "right" ? e.x + e.width : e.x + e.width / 2;
      return (
        <g>
          {/* 透明命中层：覆盖整个文本框（含空白区），点击框内任意位置都能选中/拖动整框，
              而不是只在文字像素上响应（否则框内空白点击会被当成取消选择） */}
          <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="transparent" pointerEvents="all" />
          <text
            x={tx}
            y={e.y + e.height / 2}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={e.fontSize}
            fontFamily={e.fontFamily}
            fontWeight={e.bold ? "bold" : undefined}
            fontStyle={e.italic ? "italic" : undefined}
            fill={e.fill}
            fillOpacity={fillOpacityAttr}
            pointerEvents="none"
          >
            {e.text}
          </text>
        </g>
      );
    }
    case "formula": {
      // 公式元素：衬线斜体排版，渲染前把 LaTeX 源码转成 Unicode 数学符号
      const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const tx = e.align === "left" ? e.x : e.align === "right" ? e.x + e.width : e.x + e.width / 2;
      return (
        <g>
          {/* 透明命中层：与文字同逻辑，框内任意位置可选中/拖动 */}
          <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="transparent" pointerEvents="all" />
          <text
            x={tx}
            y={e.y + e.height / 2}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={e.fontSize}
            fontFamily={e.fontFamily}
            fontWeight={e.bold ? "bold" : undefined}
            fontStyle={e.italic ? "italic" : undefined}
            fill={e.fill}
            fillOpacity={fillOpacityAttr}
            pointerEvents="none"
          >
            {latexToUnicode(e.text)}
          </text>
        </g>
      );
    }
    case "image":
      // 位图图片：拉伸填充显示框 + 描边边框（白色图片在白画布上可见边界）
      return (
        <g>
          <image href={e.src} x={e.x} y={e.y} width={e.width} height={e.height} preserveAspectRatio="none" opacity={e.opacity} />
          <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeOpacity={strokeOpacityAttr} />
        </g>
      );
    case "logic": {
      // 逻辑节点：可多种外形（矩形/平行四边形/菱形）+ 标题（顶部）+ 多行正文（小 2 号）
      const bodyFontSize = Math.max(10, e.fontSize - 2);
      const lineH = bodyFontSize * 1.4;
      const bodyLines = (e.body ?? "").split("\n");
      const shape = e.shape ?? "rect";
      // 平行四边形：上下边各向左右倾斜（offset = 宽/6）；菱形：四顶点取中点
      const offset = shape === "parallelogram" ? e.width / 6 : 0;
      const polygon = shape === "diamond"
        ? `${e.x + e.width / 2},${e.y} ${e.x + e.width},${e.y + e.height / 2} ${e.x + e.width / 2},${e.y + e.height} ${e.x},${e.y + e.height / 2}`
        : `${e.x + offset},${e.y} ${e.x + e.width + offset},${e.y} ${e.x + e.width - offset},${e.y + e.height} ${e.x - offset},${e.y + e.height}`;
      return (
        <g>
          {shape === "rect" ? (
            <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} />
          ) : (
            <polygon points={polygon} fill={e.fill} fillOpacity={fillOpacityAttr} stroke={e.stroke} strokeOpacity={strokeOpacityAttr} strokeWidth={e.strokeWidth} strokeDasharray={dashAttr} strokeLinejoin="round" />
          )}
          <text
            x={e.x + e.width / 2}
            y={e.y + 5 + (e.fontSize * 1.4) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={e.fontSize}
            fontFamily={e.fontFamily}
            fontWeight={e.bold ? "bold" : undefined}
            fill={contrastTextColor(e.fill)}
            fillOpacity={fillOpacityAttr}
          >
            {e.text}
          </text>
          {bodyLines.map((line, i) =>
            line === "" ? null : (
              <text
                key={i}
                x={e.x + e.width / 2}
                y={e.y + 5 + e.fontSize * 1.4 + i * lineH + lineH / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={bodyFontSize}
                fontFamily={e.fontFamily}
                fill={contrastTextColor(e.fill)}
                fillOpacity={e.fillOpacity !== undefined ? Math.max(0.75, fillO) : undefined}
              >
                {line}
              </text>
            )
          )}
        </g>
      );
    }
  }
}

function pointsToString(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

// 箭头头部 polygon 列表（按 head 样式）：none=空，single=终点箭头，double=终点 + 起点反向箭头。
// pts 为世界坐标点列（含折点），末段方向 → 终点箭头，首段方向 → 起点箭头
function arrowHeadPolygons(e: CanvasElement, pts: { x: number; y: number }[]): string[] {
  if (e.type !== "arrow") return [];
  const head = e.head ?? "single";
  if (head === "none") return [];
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? pts[0];
  const size = arrowHeadSize(e.strokeWidth);
  const res = [pointsToString(arrowHeadPoints(prev.x, prev.y, last.x, last.y, size))];
  if (head === "double") {
    const first = pts[0];
    const second = pts[1] ?? last;
    res.push(pointsToString(arrowHeadPoints(second.x, second.y, first.x, first.y, size)));
  }
  return res;
}
