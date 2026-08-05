"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSettings } from "@/lib/settings";

export default function FirstRunHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const s = loadSettings();
    if (!s.apiKey) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-800">
      <span>尚未配置 DeepSeek API Key</span>
      <Link href="/settings" className="font-medium underline">前往设置页</Link>
      <button type="button" aria-label="关闭提示" onClick={() => setShow(false)} className="ml-auto text-xs text-amber-500">×</button>
    </div>
  );
}
