import { describe, expect, it, vi } from "vitest";
import { DraftCanvas } from "./draft";

describe("confirmStore", () => {
  it("keeps a confirmation session available after the module is reloaded", async () => {
    const firstModule = await import("./confirmStore");
    const sessionId = `reload-${crypto.randomUUID()}`;
    const draft = new DraftCanvas([]);

    firstModule.setConfirmSession(sessionId, draft);

    // 模拟另一个 Next.js 路由包加载该模块，或开发环境发生 HMR。
    vi.resetModules();
    const reloadedModule = await import("./confirmStore");

    expect(reloadedModule.getConfirmSession(sessionId)).toBe(draft);
    reloadedModule.deleteConfirmSession(sessionId);
  });
});
