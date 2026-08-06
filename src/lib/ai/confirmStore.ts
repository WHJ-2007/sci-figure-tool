import type { DraftCanvas } from "./draft";

// 破坏性操作确认的内存会话：runAgent 结束前挂起，/api/chat/confirm 拉取执行
const TTL = 15 * 60 * 1000;
const sessions = new Map<string, { draft: DraftCanvas; ts: number }>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.ts > TTL) sessions.delete(k);
}

export function setConfirmSession(id: string, draft: DraftCanvas) {
  sweep();
  sessions.set(id, { draft, ts: Date.now() });
}

export function getConfirmSession(id: string): DraftCanvas | undefined {
  sweep();
  return sessions.get(id)?.draft;
}

export function deleteConfirmSession(id: string) {
  sessions.delete(id);
}
