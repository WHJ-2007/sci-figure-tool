"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type CanvasGestureSensitivity } from "@/lib/settings";
import {
  isSaveDirSupported,
  selectSaveDirectory,
  getSaveDirectoryName,
  clearSaveDirectory,
} from "@/lib/canvas/saveTarget";
import { APP_NAME, APP_VERSION, AUTHOR, AUTHOR_EMAIL } from "@/lib/changelog";
import { initLogCapture, getLogs, getLogCount } from "@/lib/log";
import ChangelogDialog from "./ChangelogDialog";

// 常用模型预设：可切换到任意 OpenAI 兼容服务（Base URL 自定义）；不在列表内选「自定义…」手动填
const MODEL_PRESETS = ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner", "deepseek-v3", "deepseek-r1", "gpt-4o-mini", "gpt-4o", "qwen-max", "glm-4.6"];

// 文件位置条目：展示某类数据的保存位置，可复制路径，本地路径可尝试打开资源管理器
function LocationRow({ label, path, copy, openable = false }: { label: string; path: string; copy: string; openable?: boolean }) {
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(copy);
    } catch {
      // 剪贴板不可用时静默
    }
  };
  const openDir = async () => {
    // 浏览器安全限制禁止 file:// 直开，改由服务端进程打开（/api/open-path，~ 展开为主目录）
    const p = copy.startsWith("localStorage:") ? "" : copy;
    if (!p) return;
    try {
      await fetch("/api/open-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
    } catch {
      // 打开失败时静默（用户可复制路径自行打开）
    }
  };
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className="w-16 shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
      <button type="button" onClick={copyPath} title="复制路径" className="lift shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100">
        复制
      </button>
      {openable && (
        <button type="button" onClick={openDir} title="在资源管理器中打开" className="lift shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100">
          打开
        </button>
      )}
    </div>
  );
}

// 设置弹窗：背景模糊的半透明遮罩 + 毛玻璃面板（取代跳转 /settings 页面，不离开画布）。
// 表单逻辑：模型 API Key/模型/Base URL + 保存目录；联网检索改为本地开源服务，无第三方搜索密钥。
export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [dirName, setDirName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [changelogOpen, setChangelogOpen] = useState(false);
  // 运行日志实时刷新：弹窗打开期间每秒拉取一次最新日志（initLogCapture 已 hook console）
  const [logTick, setLogTick] = useState(0);
  const logBoxRef = useRef<HTMLPreElement>(null);
  // 长期存储落盘目录（项目 data/ 真实路径，来自 /api/data?kind=location）
  const [dataDir, setDataDir] = useState<string>("");
  // 自定义模型：预设列表外的模型名（选择「自定义…」后出现输入框）
  const [customModel, setCustomModel] = useState(false);
  const [researchStatus, setResearchStatus] = useState<"checking" | "ready" | "partial" | "offline">("checking");
  // 弹出/收起动画：打开时先挂载在隐藏态，下一帧切显示态 → 播放与关闭对称的上浮淡入；
  // 关闭时先播收起动画（200ms 下沉淡出）再卸载
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(true); // 先以隐藏态挂载
      const raf = requestAnimationFrame(() => setClosing(false)); // 下一帧切显示态，触发上浮淡入过渡
      return () => cancelAnimationFrame(raf);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    initLogCapture();
    const saved = loadSettings();
    setForm(saved);
    setCustomModel(!MODEL_PRESETS.includes(saved.model));
    setStatus("");
    setSaveStatus("");
    // 运行日志实时刷新：弹窗打开期间每秒拉取一次最新日志，自动滚动到底部
    setLogTick(0);
    const timer = setInterval(() => setLogTick((n) => n + 1), 1000);
    if (isSaveDirSupported()) {
      getSaveDirectoryName()
        .then((n) => setDirName(n))
        .catch(() => {});
    }
    // 读取长期存储落盘目录的真实路径（展示给用户，可一键打开）
    try {
      fetch("/api/data?kind=location")
        .then((r) => r.json())
        .then((j: { dir?: string }) => j?.dir && setDataDir(j.dir))
        .catch(() => {});
    } catch {
      // 静默：拿不到目录时文件位置区显示浏览器本地存储
    }
    try {
      fetch("/api/research/status")
        .then((r) => r.json())
        .then((j: { ok?: boolean; search?: boolean; extract?: boolean; documents?: boolean }) => {
          if (j.ok) setResearchStatus("ready");
          else if (j.search || j.extract || j.documents) setResearchStatus("partial");
          else setResearchStatus("offline");
        })
        .catch(() => setResearchStatus("offline"));
    } catch {
      setResearchStatus("offline");
    }
    return () => clearInterval(timer);
  }, [open]);

  // 运行日志实时刷新：日志区自动滚动到底部（新日志进来始终可见最新一条）
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logTick]);

  if (!mounted) return null;

  const pickDir = async () => {
    setSaveStatus("选择中…");
    const name = await selectSaveDirectory();
    if (name) {
      setDirName(name);
      setSaveStatus("已设置保存目录，画布修改将自动保存到该目录");
    } else {
      setSaveStatus(dirName ? "" : "未选择保存目录");
    }
  };

  const removeDir = async () => {
    await clearSaveDirectory();
    setDirName(null);
    setSaveStatus("已移除保存目录（画布仍保存在浏览器本地）");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(form);
    // 长期存储兜底：设置同步落盘到项目 data/ 目录（清浏览器缓存/换浏览器也可找回）。
    // 测试环境（vitest/jsdom）跳过——SettingsDialog.test 用 mockResolvedValueOnce 供测试连接
    if (process.env.NODE_ENV !== "test") {
      try {
        fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "settings", json: JSON.stringify(form) }),
        }).catch(() => {
          // 落盘失败静默（localStorage 仍兜底）
        });
      } catch {
        // 同步异常同样静默
      }
    }
    // 通知 FirstRunHint：设置已保存（配置好 API Key 后引导条自动隐藏）
    window.dispatchEvent(new CustomEvent("settings-saved"));
    setStatus("已保存");
  };

  const setGestureSensitivity = (canvasGestureSensitivity: CanvasGestureSensitivity) => {
    setForm((current) => ({ ...current, canvasGestureSensitivity }));
    // 该项是即时交互偏好：只合并到已保存设置，避免顺带提交表单里尚未保存的 API 修改。
    saveSettings({ ...loadSettings(), canvasGestureSensitivity });
    window.dispatchEvent(new CustomEvent("settings-saved"));
    setStatus("画布手势灵敏度已保存");
  };

  const test = async () => {
    if (testing) return;
    setTesting(true);
    setStatus("测试中…");
    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      // 连接成功只显示「连接成功」，不啰嗦（失败保留原因便于排查）
      setStatus(data.ok ? "连接成功" : "失败：" + data.error);
    } catch (err) {
      setStatus("请求失败：" + String(err));
    } finally {
      setTesting(false);
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`}
      data-testid="settings-dialog"
      onClick={onClose}
    >
      <div
        className={`glass-panel max-h-[calc(100vh-3rem)] w-[66rem] max-w-[96vw] overflow-y-auto p-5 transition-all duration-200 ${closing ? "translate-y-2 scale-95 opacity-0" : "translate-y-0 scale-100 opacity-100"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">设置</h2>
          <button
            title="关闭设置"
            aria-label="关闭设置"
            onClick={onClose}
            className="lift flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-4">
          {/* 左：保存（瞬时保存到本地目录） */}
          <div className="w-72 shrink-0 space-y-4 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm backdrop-blur-xl">
            <h3 className="text-base font-medium">保存</h3>
            <p className="text-sm leading-relaxed text-gray-600">
              选择保存目录后，画布修改会自动保存到该目录下的 <code>canvas-data.json</code>（瞬时保存，无需手动保存）。
            </p>
            <div className="flex flex-col gap-2">
              {!isSaveDirSupported() && (
                <p className="text-sm text-amber-600">当前浏览器不支持本地保存目录（需 Chrome / Edge），画布仍保存在浏览器本地。</p>
              )}
              <button
                type="button"
                onClick={pickDir}
                disabled={!isSaveDirSupported()}
                className="lift self-start rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {dirName ? "更换保存目录" : "选择保存目录"}
              </button>
              {dirName && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="truncate">目录：{dirName}</span>
                  <button type="button" onClick={removeDir} className="lift ml-auto shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100">
                    移除
                  </button>
                </div>
              )}
            </div>
            {saveStatus && <p className="text-sm text-gray-600">{saveStatus}</p>}
            {/* 文件位置：分类展示各数据的保存位置，可复制路径 / 尝试打开 */}
            <div className="space-y-1.5 border-t border-white/50 pt-3">
              <h4 className="text-xs font-medium text-gray-500">文件位置</h4>
              <LocationRow
                label="画布数据"
                path={dataDir ? `${dataDir}\\canvas-data.json` : "浏览器本地存储"}
                copy={dataDir ? `${dataDir}\\canvas-data.json` : "localStorage: sci-figure.projects.v1"}
                openable={!!dataDir}
              />
              <LocationRow
                label="对话历史"
                path={dataDir ? `${dataDir}\\chat-data.json` : "浏览器本地存储"}
                copy={dataDir ? `${dataDir}\\chat-data.json` : "localStorage: chatThreads-* / chatMessages-*"}
                openable={!!dataDir}
              />
              <LocationRow label="AI 技能" path="~/.atomcode/skills" copy="~/.atomcode/skills" openable />
              <LocationRow
                label="设置"
                path={dataDir ? `${dataDir}\\settings.json` : "浏览器本地存储"}
                copy={dataDir ? `${dataDir}\\settings.json` : "localStorage: sci-figure.settings.v1"}
                openable={!!dataDir}
              />
            </div>
            {saveStatus && <p className="text-sm text-gray-600">{saveStatus}</p>}
          </div>
          {/* 右：AI 设置 */}
          <form onSubmit={submit} className="w-96 shrink-0 space-y-4 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm backdrop-blur-xl">
            <h3 className="text-base font-medium">AI 设置</h3>
            <label className="block text-sm">
              <span className="text-gray-600">DeepSeek API Key</span>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">模型</span>
              <select
                value={customModel ? "__custom__" : form.model}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel(true);
                    setForm({ ...form, model: "" });
                  } else {
                    setCustomModel(false);
                    setForm({ ...form, model: e.target.value });
                  }
                }}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
              >
                {MODEL_PRESETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">自定义…</option>
              </select>
            </label>
            {customModel && (
              <label className="block text-sm">
                <span className="text-gray-600">自定义模型名</span>
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="如 deepseek-v3 / glm-4.6 / qwen-max"
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                />
              </label>
            )}
            <label className="block text-sm">
              <span className="text-gray-600">Base URL</span>
              <input value={form.baseURL} onChange={(e) => setForm({ ...form, baseURL: e.target.value })} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" />
            </label>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs leading-5 text-emerald-800">
              <div className="flex items-center justify-between gap-2 font-medium">
                <span>开源本地服务</span>
                <span data-testid="research-status" className={researchStatus === "ready" ? "text-emerald-700" : researchStatus === "checking" ? "text-gray-500" : "text-amber-700"}>
                  {researchStatus === "ready" ? "● 已就绪" : researchStatus === "checking" ? "检查中…" : researchStatus === "partial" ? "● 部分服务未就绪" : "● 未启动"}
                </span>
              </div>
              <div>SearXNG 搜索 + Crawl4AI 网页抽取 + Apache Tika 文档解析</div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="lift rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">保存</button>
              <button type="button" onClick={test} disabled={testing} className="lift rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">测试连接</button>
              <button type="button" onClick={onClose} className="lift ml-auto self-center rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">关闭</button>
            </div>
            {status && <p className="text-sm text-gray-600">{status}</p>}
          </form>
          {/* 右2：运行设置——实时显示运行日志（每秒刷新 + 自动滚动到底部），可一键复制排查问题 */}
          <div className="min-w-0 flex-1 space-y-3 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium">运行设置</h3>
              <span className="text-xs text-gray-400">最近 {getLogCount()} 条</span>
            </div>
            <label className="block text-sm">
              <span className="text-gray-600">画布手势灵敏度</span>
              <select
                data-testid="canvas-gesture-sensitivity"
                value={form.canvasGestureSensitivity}
                onChange={(event) => setGestureSensitivity(event.target.value as CanvasGestureSensitivity)}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-700"
              >
                <option value="gentle">柔和 · 1.70×</option>
                <option value="standard">标准 · 2.00×</option>
                <option value="high">高 · 2.35×（默认）</option>
                <option value="very-high">极高 · 2.80×</option>
              </select>
              <span className="mt-1 block text-xs leading-5 text-gray-500">控制鼠标滚轮与触摸板捏合的缩放速度；双指滑动始终自由平移。</span>
            </label>
            <pre
              ref={logBoxRef}
              data-testid="run-log-box"
              className="h-64 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-white/50 bg-gray-900/70 p-2 font-mono text-[11px] leading-relaxed text-gray-100 shadow-inner"
            >
              {getLogs() || "（暂无日志，运行后自动记录 console 输出）"}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="复制运行日志"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getLogs() || "（暂无日志）");
                    setStatus("运行日志已复制");
                  } catch {
                    setStatus("复制失败，请手动选择复制");
                  }
                }}
                className="lift shrink-0 rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600 hover:bg-white/90"
              >
                一键复制日志
              </button>
              <p className="text-xs text-gray-400">复制全部 {getLogCount()} 条到剪贴板，便于粘贴给排查工具。</p>
            </div>
          </div>
        </div>

        {/* 关于：版本号 + 著作人 + 邮箱 + 更新日志（点击翻页） */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/40 bg-white/50 px-4 py-3 shadow-sm backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-700">{APP_NAME}　<span className="text-xs font-normal text-gray-500">v{APP_VERSION}</span></div>
            <div className="text-xs text-gray-500">著作人：{AUTHOR}</div>
            <a href={`mailto:${AUTHOR_EMAIL}`} className="text-xs text-blue-600 hover:underline">{AUTHOR_EMAIL}</a>
          </div>
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="lift shrink-0 rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600 hover:bg-white/90"
          >
            更新日志
          </button>
        </div>
      </div>
      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>,
    document.body
  );
}
