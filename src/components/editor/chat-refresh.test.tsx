// 刷新丢对话复现测试：预置 localStorage（projects + 当前画布 id + 对话），
// 模拟浏览器整页刷新（vi.resetModules 清模块缓存后重新 import store/ChatPanel），
// 验证刷新后历史对话能恢复
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const DOC = { width: 1600, height: 1000, elements: [] };

describe("刷新后对话恢复", () => {
  it("真实刷新：localStorage 有 projects+当前画布+对话，重新加载模块后对话恢复", async () => {
    const pid = "pid-refresh-1";
    // 预置浏览器本地存储（模拟用户上次使用后的状态）
    localStorage.setItem(
      "sci-figure.projects.v1",
      JSON.stringify([{ id: pid, name: "画布 1", doc: DOC }])
    );
    localStorage.setItem("sci-figure.current-project.v1", pid);
    localStorage.setItem(
      `chatThreads-${pid}`,
      JSON.stringify({
        threads: [
          {
            id: `t-${pid}-default`,
            name: "对话 1",
            messages: [
              { role: "user", content: "刷新前的问题" },
              { role: "assistant", content: "刷新前的回答" },
            ],
          },
        ],
        activeId: `t-${pid}-default`,
      })
    );
    // 模拟浏览器整页刷新：清空模块缓存后重新 import（store 会重新执行 loadProjects）
    vi.resetModules();
    const { useCanvasStore } = await import("@/lib/canvas/store");
    const { default: ChatPanel } = await import("./ChatPanel");
    // store 应从 localStorage 恢复画布 id（否则对话键对不上）
    expect(useCanvasStore.getState().currentProjectId).toBe(pid);
    render(<ChatPanel />);
    await waitFor(() => expect(screen.getByText("刷新前的问题")).toBeInTheDocument());
    expect(screen.getByText("刷新前的回答")).toBeInTheDocument();
  });

  it("真实刷新：旧格式 chatMessages 也能恢复（兼容迁移）", async () => {
    const pid = "pid-refresh-2";
    localStorage.setItem(
      "sci-figure.projects.v1",
      JSON.stringify([{ id: pid, name: "画布 1", doc: DOC }])
    );
    localStorage.setItem("sci-figure.current-project.v1", pid);
    localStorage.setItem(
      `chatMessages-${pid}`,
      JSON.stringify([
        { role: "user", content: "旧格式问题" },
        { role: "assistant", content: "旧格式回答" },
      ])
    );
    vi.resetModules();
    const { default: ChatPanel } = await import("./ChatPanel");
    render(<ChatPanel />);
    await waitFor(() => expect(screen.getByText("旧格式问题")).toBeInTheDocument());
    expect(screen.getByText("旧格式回答")).toBeInTheDocument();
  });

  it("真实刷新：localStorage 有 projects（画布 id 稳定）但 chatThreads 缺失时，从文件备份恢复对话", async () => {
    // ChatPanel 的对话文件恢复路径要求非 test 环境（生产行为），这里模拟生产
    vi.stubEnv("NODE_ENV", "production");
    const pid = "pid-refresh-3";
    localStorage.setItem(
      "sci-figure.projects.v1",
      JSON.stringify([{ id: pid, name: "画布 1", doc: DOC }])
    );
    localStorage.setItem("sci-figure.current-project.v1", pid);
    // localStorage 无对话，但文件备份（data/chat-data.json）里有：模拟清缓存后靠备份找回
    const backupKey = `chatThreads-${pid}`;
    const backupChat = JSON.stringify({
      [backupKey]: {
        threads: [
          {
            id: `t-${pid}-default`,
            name: "对话 1",
            messages: [
              { role: "user", content: "备份里的问题" },
              { role: "assistant", content: "备份里的回答" },
            ],
          },
        ],
        activeId: `t-${pid}-default`,
      },
    });
    const fakeFetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const isPost = (init?.method ?? "GET").toUpperCase() === "POST";
      if (isPost) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      if (u.includes("kind=chat")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: backupChat }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: null }) });
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { default: ChatPanel } = await import("./ChatPanel");
    render(<ChatPanel />);
    await waitFor(() => expect(screen.getByText("备份里的问题")).toBeInTheDocument());
    expect(screen.getByText("备份里的回答")).toBeInTheDocument();
  });

  it("真实刷新：localStorage 画布数据缺失（容量超限被 catch 吞掉）时，从文件备份恢复画布 id 与对话", async () => {
    // 模块加载后的自动兜底与 ChatPanel 对话文件恢复均要求非 test 环境（生产行为）
    vi.stubEnv("NODE_ENV", "production");
    const pid = "pid-from-backup";
    const backupCanvas = JSON.stringify([{ id: pid, name: "画布 1", doc: DOC }]);
    const backupChat = JSON.stringify({
      [`chatThreads-${pid}`]: {
        threads: [
          { id: `t-${pid}-default`, name: "对话 1", messages: [{ role: "user", content: "备份对话" }] },
        ],
        activeId: `t-${pid}-default`,
      },
    });
    // 按请求分发：GET kind=canvas 返回画布备份；GET kind=chat 返回对话备份；POST 忽略
    const fakeFetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const isPost = (init?.method ?? "GET").toUpperCase() === "POST";
      if (isPost) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      if (u.includes("kind=canvas")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: backupCanvas }) });
      if (u.includes("kind=chat")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: backupChat }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: "{}" }) });
    });
    vi.stubGlobal("fetch", fakeFetch);
    // 关键：不预置 sci-figure.projects.v1（模拟容量超限时 saveProjects 静默失败，localStorage 无画布数据）
    localStorage.removeItem("sci-figure.projects.v1");
    localStorage.removeItem("sci-figure.current-project.v1");
    vi.resetModules();
    const { useCanvasStore } = await import("@/lib/canvas/store");
    const { default: ChatPanel } = await import("./ChatPanel");
    render(<ChatPanel />);
    // store 应从文件备份恢复画布 id（否则对话键对不上）；模块加载后的自动兜底已执行
    await waitFor(() => expect(useCanvasStore.getState().currentProjectId).toBe(pid));
    // 对话随之恢复
    await waitFor(() => expect(screen.getByText("备份对话")).toBeInTheDocument());
  });
});
