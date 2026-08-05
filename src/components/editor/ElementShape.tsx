import type { CanvasElement } from "@/lib/canvas/types";
import { shapePoints, arrowHeadPoints } from "@/lib/canvas/geometry";

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
          <polygon points={pointsToString(arrowHeadPoints(prev.x, prev.y, last.x, last.y))} fill={e.stroke} opacity={e.opacity} />
        </g>
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
  }
}

function pointsToString(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}
