"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import {
  isSaveDirSupported,
  selectSaveDirectory,
  getSaveDirectoryName,
  clearSaveDirectory,
} from "@/lib/canvas/saveTarget";
import { APP_NAME, APP_VERSION, AUTHOR, AUTHOR_EMAIL } from "@/lib/changelog";
import ChangelogDialog from "./ChangelogDialog";

// 常用模型预设：可切换到任意 OpenAI 兼容服务（Base URL 自定义）；不在列表内选「自定义…」手动填
const MODEL_PRESETS = ["deepseek-chat", "deepseek-reasoner", "deepseek-v3", "deepseek-r1", "gpt-4o-mini", "gpt-4o", "qwen-max", "glm-4.6"];

// 文件位置条目：展示某类数据的保存位置，可复制路径，本地路径可尝试打开资源管理器
function LocationRow({ label, path, copy, openable = false }: { label: string; path: string; copy: string; openable?: boolean }) {
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(copy);
    } catch {
      // 剪贴板不可用时静默
    }
  };
  const openDir = () => {
    // 浏览器安全限制：file:// 直接打开可能被拦截，失败时提示复制路径
    const p = copy.startsWith("localStorage:") ? "" : copy;
    if (p) window.open(`file:///${p.replace(/\\/g, "/").replace(/^~/, "")}`, "_blank");
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
// 表单逻辑与旧设置页一致（API Key/模型/Base URL/Tavily + 保存目录）。
export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [dirName, setDirName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [changelogOpen, setChangelogOpen] = useState(false);
  // 自定义模型：预设列表外的模型名（选择「自定义…」后出现输入框）
  const [customModel, setCustomModel] = useState(false);
  // 弹出/收起动画：open 时挂载+淡入上浮；关闭时先播收起动画（200ms）再卸载
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const saved = loadSettings();
    setForm(saved);
    setCustomModel(!MODEL_PRESETS.includes(saved.model));
    setStatus("");
    setSaveStatus("");
    if (isSaveDirSupported()) {
      getSaveDirectoryName()
        .then((n) => setDirName(n))
        .catch(() => {});
    }
  }, [open]);

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
    setStatus("已保存");
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
        className={`glass-panel max-h-[calc(100vh-3rem)] w-[46.5rem] max-w-[94vw] overflow-y-auto p-5 transition-all duration-200 ${closing ? "translate-y-2 scale-95 opacity-0" : "translate-y-0 scale-100 opacity-100"}`}
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
          <div className="w-72 shrink-0 space-y-4 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm">
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
              <LocationRow label="画布数据" path={dirName ? "保存目录/canvas-data.json" : "浏览器本地存储"} copy={dirName ? `${dirName}\\canvas-data.json` : "localStorage: sci-figure.projects.v1"} />
              <LocationRow label="对话历史" path="浏览器本地存储" copy="localStorage: chatThreads-* / chatMessages-*" />
              <LocationRow label="AI 技能" path="~/.atomcode/skills" copy="~/.atomcode/skills" openable />
              <LocationRow label="设置" path="浏览器本地存储" copy="localStorage: sci-figure.settings.v1" />
            </div>
            {saveStatus && <p className="text-sm text-gray-600">{saveStatus}</p>}
          </div>
          {/* 右：AI 设置 */}
          <form onSubmit={submit} className="w-96 shrink-0 space-y-4 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm">
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
            <label className="block text-sm">
              <span className="text-gray-600">Tavily API Key（可选，配置后 AI 可联网搜索权威数据）</span>
              <input
                type="password"
                value={form.tavilyApiKey ?? ""}
                onChange={(e) => setForm({ ...form, tavilyApiKey: e.target.value })}
                placeholder="tvly-..."
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="lift rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">保存</button>
              <button type="button" onClick={test} disabled={testing} className="lift rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">测试连接</button>
              <button type="button" onClick={onClose} className="lift ml-auto self-center rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">关闭</button>
            </div>
            {status && <p className="text-sm text-gray-600">{status}</p>}
          </form>
        </div>

        {/* 关于：版本号 + 著作人 + 邮箱 + 更新日志（点击翻页） */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/40 bg-white/50 px-4 py-3 shadow-sm">
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
