"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CHANGELOG, APP_VERSION } from "@/lib/changelog";

// 更新日志弹窗：一页一个版本（上一版/下一版翻页）。
// 版本内分一级标题/二级标题：一级标题点击展开/收起，展示其下二级标题与小内容，带展开收回动画。
export default function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [page, setPage] = useState(0);
  // 展开的一级标题集合：默认展开当前版本第一个有内容的一级标题
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const first = CHANGELOG.find((v) => v.sections.length > 0);
    return new Set(first && first.sections.length > 0 ? [first.sections[0].title] : []);
  });
  if (!open) return null;
  const total = CHANGELOG.length;
  const entry = CHANGELOG[page];
  if (!entry) return null;

  const toggle = (title: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  return createPortal(
    // 遮罩点击 = 只退出更新日志这一层（stopPropagation 阻止冒泡到设置弹窗遮罩，避免整个设置被关闭）
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="changelog-dialog" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="glass-panel max-h-[85vh] w-[40rem] max-w-[94vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">更新日志</h2>
          <button title="关闭更新日志" aria-label="关闭更新日志" onClick={onClose} className="lift flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </div>

        {/* 版本内容：key={page} 翻页时重挂载，播放 page-open 淡入上浮动画 */}
        <div key={page} className="page-open">
          {/* 当前版本：版本号 + 时间 + 摘要 */}
          <div className="mb-3 rounded-xl border border-white/40 bg-white/60 p-4 shadow-sm backdrop-blur-xl">
            <div className="text-sm font-semibold text-gray-800">
              版本 {entry.version}
              <span className="ml-2 text-xs font-normal text-gray-400">{entry.time}</span>
              {entry.sections.length === 0 && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">开发中</span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">{entry.summary}</p>
          </div>

          {/* 一级标题列表：点击展开/收起二级标题（grid-rows 过渡动画） */}
          <div className="space-y-2">
            {entry.sections.length === 0 && <p className="text-xs text-gray-400">暂无更新内容</p>}
            {entry.sections.map((sec) => {
              const isOpen = expanded.has(sec.title);
              return (
                <div key={sec.title} className="overflow-hidden rounded-xl border border-white/40 bg-white/60 shadow-sm backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => toggle(sec.title)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/70"
                    aria-expanded={isOpen}
                  >
                    <span className={`shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>▶</span>
                    <span className="text-sm font-semibold text-gray-800">{sec.title}</span>
                  </button>
                  {/* 展开动画：grid-template-rows 0fr → 1fr */}
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="space-y-3 border-t border-white/50 px-4 py-3">
                        {sec.subsections.map((sub) => (
                          <div key={sub.title}>
                            <div className="mb-1 text-xs font-semibold text-gray-700">{sub.title}</div>
                            <ul className="space-y-1">
                              {sub.items.map((c, i) => (
                                <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
                                  <span className="shrink-0 text-blue-500">·</span>
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 分页：上一版 / 下一版（一页一个版本） */}
        <div className="mt-4 flex items-center justify-between">
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
