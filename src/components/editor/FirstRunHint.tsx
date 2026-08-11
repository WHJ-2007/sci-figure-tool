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
    // 设置保存后自动刷新：配置好 API Key 立即隐藏引导条（不再需要手动刷新/重进页面）
    const onSettingsSaved = () => {
      const st = loadSettings();
      if (st.apiKey) setShow(false);
    };
    window.addEventListener("settings-saved", onSettingsSaved);
    return () => window.removeEventListener("settings-saved", onSettingsSaved);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-amber-200/60 bg-amber-50/70 px-4 py-1.5 text-sm text-amber-800 backdrop-blur-xl">
      <span>尚未配置 DeepSeek API Key</span>
      <button type="button" onClick={requestOpenSettings} className="lift font-medium underline">前往设置</button>
      <button type="button" aria-label="关闭提示" onClick={() => setShow(false)} className="lift ml-auto text-xs text-amber-500">×</button>
    </div>
  );
}
