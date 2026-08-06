import type { CanvasElement } from "@/lib/canvas/types";
import { shapePoints, arrowHeadPoints, curveControl } from "@/lib/canvas/geometry";
import { contrastTextColor } from "@/lib/canvas/elements";

export default function ElementShape({ e }: { e: CanvasElement }) {
  const rot = e.rotation
    ? `rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.height / 2})`
    : undefined;
  const common = {
    fill: e.fill,
    stroke: e.stroke,
    strokeWidth: e.strokeWidth,
    opacity: e.opacity,
  };
  const g = <g transform={rot}>{renderBody(e, common)}</g>;
  return <g data-element-id={e.id}>{g}</g>;
}

function renderBody(
  e: CanvasElement,
  common: { fill: string; stroke: string; strokeWidth: number; opacity: number }
): React.ReactNode {
  switch (e.type) {
    case "rect":
      return <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} {...common} />;
    case "ellipse":
      return (
        <ellipse cx={e.x + e.width / 2} cy={e.y + e.height / 2} rx={e.width / 2} ry={e.height / 2} {...common} />
      );
    case "triangle":
    case "diamond":
    case "hexagon":
      return <polygon points={pointsToString(shapePoints(e.type, e))} {...common} />;
    case "arrow": {
      const x2 = e.x + e.width;
      const y2 = e.y + e.height;
      return (
        <g>
          <line x1={e.x} y1={e.y} x2={x2} y2={y2} stroke={e.stroke} strokeWidth={e.strokeWidth} opacity={e.opacity} />
          <polygon points={pointsToString(arrowHeadPoints(e.x, e.y, x2, y2))} fill={e.stroke} opacity={e.opacity} />
        </g>
      );
    }
    case "polyline": {
      const last = e.points[e.points.length - 1];
      const prev = e.points[e.points.length - 2] ?? e.points[0];
      return (
        <g>
          <polyline points={pointsToString(e.points)} fill="none" stroke={e.stroke} strokeWidth={e.strokeWidth} opacity={e.opacity} />
          {e.arrow !== false && (
            <polygon points={pointsToString(arrowHeadPoints(prev.x, prev.y, last.x, last.y))} fill={e.stroke} opacity={e.opacity} />
          )}
        </g>
      );
    }
    case "curve": {
      const c = curveControl(e);
      return (
        <path
          d={`M ${e.x} ${e.y} Q ${c.x} ${c.y} ${e.x + e.width} ${e.y + e.height}`}
          fill="none"
          stroke={e.stroke}
          strokeWidth={e.strokeWidth}
          opacity={e.opacity}
        />
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
      return (
        <path d={`M ${e.x} ${e.y} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`} {...common} />
      );
    }
    case "text": {
      const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const tx = e.align === "left" ? e.x : e.align === "right" ? e.x + e.width : e.x + e.width / 2;
      return (
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
          opacity={e.opacity}
        >
          {e.text}
        </text>
      );
    }
    case "logic": {
      // 逻辑节点：圆角矩形 + 标题（顶部）+ 多行正文（小 2 号），布局与 logicBoxSize 公式一致
      const bodyFontSize = Math.max(10, e.fontSize - 2);
      const lineH = bodyFontSize * 1.4;
      const bodyLines = (e.body ?? "").split("\n");
      return (
        <g>
          <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} {...common} />
          <text
            x={e.x + e.width / 2}
            y={e.y + 5 + (e.fontSize * 1.4) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={e.fontSize}
            fontFamily={e.fontFamily}
            fontWeight={e.bold ? "bold" : undefined}
            fill={contrastTextColor(e.fill)}
            opacity={e.opacity}
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
                opacity={Math.max(0.75, e.opacity)}
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
