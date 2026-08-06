"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import {
  isSaveDirSupported,
  selectSaveDirectory,
  getSaveDirectoryName,
  clearSaveDirectory,
} from "@/lib/canvas/saveTarget";

export default function SettingsPage() {
  const [form, setForm] = useState({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [dirName, setDirName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>("");

  useEffect(() => {
    setForm(loadSettings());
    if (isSaveDirSupported()) {
      getSaveDirectoryName()
        .then((n) => setDirName(n))
        .catch(() => {});
    }
  }, []);

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
      setStatus(data.ok ? "连接成功：" + data.text : "失败：" + data.error);
    } catch (err) {
      setStatus("请求失败：" + String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center gap-4 p-4">
      {/* 左：保存（瞬时保存到本地目录） */}
      <div className="page-open w-80 space-y-4 rounded-xl border border-white/40 bg-white/60 p-6 shadow-lg backdrop-blur-md">
        <h1 className="text-lg font-medium">保存</h1>
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
      </div>
      {/* 右：AI 设置 */}
      <form onSubmit={submit} className="page-open w-96 space-y-4 rounded-xl border border-white/40 bg-white/60 p-6 shadow-lg backdrop-blur-md">
        <h1 className="text-lg font-medium">AI 设置</h1>
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
          <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
          </select>
        </label>
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
          <Link href="/" title="返回画布" className="lift ml-auto self-center text-sm text-gray-500 hover:underline">← 返回画布</Link>
        </div>
        {status && <p className="text-sm text-gray-600">{status}</p>}
      </form>
    </div>
  );
}
