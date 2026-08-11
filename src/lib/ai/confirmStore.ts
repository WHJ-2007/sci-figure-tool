import type { DraftCanvas } from "./draft";

// 破坏性操作确认的内存会话：runAgent 结束前挂起，/api/chat/confirm 拉取执行
// resolved：用户已表态（确认/取消）的挂起项 id，全部表态后会话才删除（多挂起项逐条确认会话保活）
// applied：已实际执行的挂起项 id（幂等：防重试/重复提交把同一操作执行两次）
const TTL = 15 * 60 * 1000;
const sessions = new Map<string, { draft: DraftCanvas; resolved: Set<string>; applied: Set<string>; ts: number }>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.ts > TTL) sessions.delete(k);
}

export function setConfirmSession(id: string, draft: DraftCanvas) {
  sweep();
  sessions.set(id, { draft, resolved: new Set(), applied: new Set(), ts: Date.now() });
}

export function getConfirmSession(id: string): DraftCanvas | undefined {
  sweep();
  return sessions.get(id)?.draft;
}

export function deleteConfirmSession(id: string) {
  sessions.delete(id);
}

// 用户已对这批复表态（含取消）：多挂起项逐条确认时，会话需等全部表态后才由 isSessionComplete 删除。
// 返回本批"新表态"的数量（此前未表态过的 id 数）：isSessionComplete 据此区分"完成批次的请求"
// 与"纯重试/重复提交"，完成批不删会话（幂等重试需要会话存活应答），重试批才真正删除。
export function markResolved(sessionId: string, ids: string[]): number {
  const s = sessions.get(sessionId);
  if (!s) return 0;
  let added = 0;
  for (const pid of ids) {
    if (typeof pid === "string" && !s.resolved.has(pid)) {
      s.resolved.add(pid);
      added++;
    }
  }
  return added;
}

// 挂起项已实际执行（确认项 apply 前标记）：幂等，防重试/重复提交二次执行
export function markApplied(sessionId: string, id: string) {
  sessions.get(sessionId)?.applied.add(id);
}

export function isApplied(sessionId: string, id: string): boolean {
  return sessions.get(sessionId)?.applied.has(id) ?? false;
}

// 全部挂起项都已表态（含取消）→ 会话已不再需要，返回 true 供调用方感知。
// 注意：这里**不再删除会话**——重复提交/重试同一批次时，isApplied 已保证幂等跳过执行；
// 若在此删除，任何后续（含前端自动续跑）对同一 sessionId 的确认请求都会 404「确认会话已失效」。
// 残留会话由 TTL sweep 15 分钟兜底清理，不删除更稳（幂等 + 防 404 双保险）。
export function isSessionComplete(sessionId: string, pendingCount: number, newlyResolved = 0): boolean {
  const s = sessions.get(sessionId);
  if (!s) return true;
  return s.resolved.size >= pendingCount;
}
