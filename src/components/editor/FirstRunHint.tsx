"use client";

import { useEffect, useState } from "react";
import { loadSettings } from "@/lib/settings";

// 打开设置弹窗：Toolbar 监听该事件弹出 SettingsDialog（旧 /settings 页面已删除）
export function requestOpenSettings() {
  window.dispatchEvent(new CustomEvent("open-settings"));
}

export default function FirstRunHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const s = loadSettings();
    if (!s.apiKey) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-amber-200/60 bg-amber-50/70 px-4 py-1.5 text-sm text-amber-800 backdrop-blur-md">
      <span>尚未配置 DeepSeek API Key</span>
      <button type="button" onClick={requestOpenSettings} className="lift font-medium underline">前往设置</button>
      <button type="button" aria-label="关闭提示" onClick={() => setShow(false)} className="lift ml-auto text-xs text-amber-500">×</button>
    </div>
  );
}
