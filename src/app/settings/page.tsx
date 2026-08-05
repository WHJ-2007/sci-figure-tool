"use client";

import Link from "next/link";
import { useState } from "react";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";

export default function SettingsPage() {
  const [form, setForm] = useState(loadSettings());
  const [status, setStatus] = useState<string>("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(form);
    setStatus("已保存");
  };

  const test = async () => {
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
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="w-96 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-medium">设置</h1>
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
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">保存</button>
          <button type="button" onClick={test} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100">测试连接</button>
          <Link href="/" className="ml-auto self-center text-sm text-gray-500 hover:underline">← 返回画布</Link>
        </div>
        {status && <p className="text-sm text-gray-600">{status}</p>}
      </form>
    </div>
  );
}
