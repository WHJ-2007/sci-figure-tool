// 运行日志收集：hook console（log/info/warn/error），保留最近 200 条带时间戳的日志，
// 供设置弹窗「运行日志一键复制」排查问题（报错信息、AI 生成失败等）。
// 仅浏览器环境生效（模块级惰性初始化），jsdom 测试环境不拦截 console 以免干扰测试断言。

interface LogEntry {
  time: string;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

const MAX = 200;
let entries: LogEntry[] = [];
let installed = false;

function fmt(level: LogEntry["level"], args: unknown[]): string {
  const text = args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
  return `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${level.toUpperCase()} ${text}`;
}

export function initLogCapture(): void {
  if (installed || typeof window === "undefined" || typeof console === "undefined") return;
  installed = true;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      entries.push({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), level, text: fmt(level, args) });
      if (entries.length > MAX) entries = entries.slice(entries.length - MAX);
      orig(...args);
    };
  }
}

export function getLogs(): string {
  return entries.map((e) => e.text).join("\n");
}

export function getLogCount(): number {
  return entries.length;
}

export function clearLogs(): void {
  entries = [];
}
