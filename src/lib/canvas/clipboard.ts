import { useCanvasStore } from "./store";
import { newId } from "./elements";
import type { CanvasElement } from "./types";
import type { ChartSpec } from "./chartLayout";

// 复制缓冲区：选中元素 + 关联图表声明（图表元素必须带 spec，否则粘贴后编辑图表数据无声明）。
// 图表声明/元素引用同一 chartId，粘贴时整体换新 chartId，避免粘贴副本与源图表共用声明互相影响
interface CopyPayload {
  elements: CanvasElement[];
  charts?: Record<string, ChartSpec>;
}

// 内部剪贴板（模块级缓存）：复制/粘贴同会话内即时可用，不依赖系统剪贴板权限
let internalClipboard: CopyPayload | null = null;

const CLIPBOARD_JSON_PREFIX = "figtool-copy:v1:";

// 复制当前选中元素到剪贴板：内部缓存 + 系统剪贴板 JSON 兜底（跨刷新/跨页面可恢复，失败静默）
export function copySelection(): void {
  const s = useCanvasStore.getState();
  const selected = s.doc.elements.filter((e) => s.selection.includes(e.id));
  if (selected.length === 0) return;
  // 收集选中元素引用的图表 id（chartId 或 bind.chartId），带出对应 spec 深拷贝
  const chartIds = new Set<string>();
  for (const e of selected) {
    if (e.chartId) chartIds.add(e.chartId);
    if (e.bind?.chartId) chartIds.add(e.bind.chartId);
  }
  const charts: Record<string, ChartSpec> = {};
  for (const cid of chartIds) {
    const spec = s.doc.charts?.[cid];
    if (spec) charts[cid] = structuredClone(spec);
  }
  const payload: CopyPayload = {
    elements: selected.map((e) => structuredClone(e)),
    ...(Object.keys(charts).length ? { charts } : {}),
  };
  internalClipboard = payload;
  // 系统剪贴板兜底：写入带前缀的 JSON，粘贴时无内部缓存（刷新/新页面）可从系统剪贴板恢复；
  // 非安全上下文（http）或权限拒绝时静默忽略，不影响内部缓存复制
  try {
    const json = CLIPBOARD_JSON_PREFIX + JSON.stringify(payload);
    void navigator.clipboard?.writeText(json).catch(() => {});
  } catch {
    /* 剪贴板不可用则忽略 */
  }
}

// 粘贴：优先内部缓存，为空时尝试读系统剪贴板（跨刷新恢复）；偏移 +20 生成新元素，
// 图表声明/引用换新 chartId、组合换新 groupId，一次入栈（pasteElements）并选中粘贴副本
export async function pasteClipboard(): Promise<boolean> {
  let payload = internalClipboard;
  if (!payload) {
    payload = await readSystemClipboard();
    if (!payload) return false;
  }
  const s = useCanvasStore.getState();
  if (payload.elements.length === 0) return false;
  // 旧 id → 新 id：元素、图表声明、组合 groupId 各自重映射
  const idMap = new Map<string, string>();
  for (const e of payload.elements) idMap.set(e.id, newId());
  const chartIdMap = new Map<string, string>();
  for (const cid of Object.keys(payload.charts ?? {})) chartIdMap.set(cid, newId());
  const groupIdMap = new Map<string, string>();
  const offset = 20;
  const copies: CanvasElement[] = payload.elements.map((e) => {
    const c = structuredClone(e);
    c.id = idMap.get(e.id) ?? newId();
    c.x += offset;
    c.y += offset;
    // 点列（polyline/pen）是绝对坐标，需同步平移；箭头折点是相对坐标（相对起点）不需平移
    if (c.type === "polyline" || c.type === "pen") {
      c.points = c.points.map((p) => ({ x: p.x + offset, y: p.y + offset }));
    }
    if (c.chartId && chartIdMap.has(c.chartId)) c.chartId = chartIdMap.get(c.chartId);
    if (c.bind?.chartId && chartIdMap.has(c.bind.chartId)) {
      c.bind = { ...c.bind, chartId: chartIdMap.get(c.bind.chartId)! };
    }
    // 组合换新 groupId：粘贴副本自成一组，不与源组合共享（避免点击副本连带选中源组元素）
    if (c.groupId) {
      if (!groupIdMap.has(c.groupId)) groupIdMap.set(c.groupId, newId());
      c.groupId = groupIdMap.get(c.groupId);
    }
    return c;
  });
  const charts: Record<string, ChartSpec> | undefined = payload.charts
    ? Object.fromEntries(
        Object.entries(payload.charts).map(([cid, spec]) => [chartIdMap.get(cid) ?? newId(), structuredClone(spec)])
      )
    : undefined;
  useCanvasStore.getState().pasteElements(copies, charts);
  return true;
}

// 从系统剪贴板读取本工具复制的 JSON（带前缀校验，防止解析无关文本）
async function readSystemClipboard(): Promise<CopyPayload | null> {
  try {
    const text = await navigator.clipboard?.readText();
    if (!text || !text.startsWith(CLIPBOARD_JSON_PREFIX)) return null;
    const parsed = JSON.parse(text.slice(CLIPBOARD_JSON_PREFIX.length)) as CopyPayload;
    if (!Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}
