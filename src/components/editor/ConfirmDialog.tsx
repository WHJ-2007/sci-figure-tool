"use client";

import { createPortal } from "react-dom";

export default function ConfirmDialog({
  pending,
  busy,
  onAction,
  onClose,
}: {
  pending: { id: string; description: string }[];
  busy: boolean;
  onAction: (id: string, approved: boolean) => void;
  onClose: () => void;
}) {
  // portal 到 body：聊天面板的 backdrop-blur 会为 fixed 后代创建包含块，直接渲染会被面板裁剪/定位错误
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      data-testid="confirm-dialog"
      onClick={onClose}
    >
      <div className="glass-panel w-96 max-w-[90vw] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-semibold text-gray-800">AI 想执行以下操作</h3>
        <p className="mb-4 text-xs text-gray-500">请逐条确认是否允许（取消则跳过该操作）：</p>
        <div className="space-y-3">
          {pending.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/60 bg-white/60 px-3 py-2 shadow-sm">
              <div className="mb-2 text-sm text-gray-700">{p.description}</div>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => onAction(p.id, true)}
                  className="lift rounded-lg bg-blue-600/85 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  确认
                </button>
                <button
                  disabled={busy}
                  onClick={() => onAction(p.id, false)}
                  className="lift rounded-lg bg-red-500/85 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
