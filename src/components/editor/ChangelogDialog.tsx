"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CHANGELOG, APP_VERSION } from "@/lib/changelog";

// 更新日志弹窗：按版本条目分页浏览历史更新日志（人话、简练），可翻页
export default function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [page, setPage] = useState(0);
  if (!open) return null;
  const total = CHANGELOG.length;
  const entry = CHANGELOG[page];
  if (!entry) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="changelog-dialog" onClick={onClose}>
      <div className="glass-panel max-h-[85vh] w-[40rem] max-w-[94vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">更新日志（v{APP_VERSION}）</h2>
          <button title="关闭更新日志" aria-label="关闭更新日志" onClick={onClose} className="lift flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </div>

        {/* 版本条目：时间 + 变更列表 */}
        <div key={entry.time} className="mb-4 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-gray-700">{entry.time}</div>
          <ul className="space-y-1.5">
            {entry.changes.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
                <span className="shrink-0 text-blue-500">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 分页：上一版 / 下一版 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-40"
          >
            ← 较新
          </button>
          <span className="text-xs text-gray-400">{page + 1} / {total} 个版本</span>
          <button
            onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
            disabled={page >= total - 1}
            className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-40"
          >
            较旧 →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
