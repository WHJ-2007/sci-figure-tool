"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 教学步骤：selector 定位真实 DOM 元素（高亮/聚焦），title+text 是气泡标注（磨砂玻璃），
// 点击目标元素后自动进入下一步；selector 缺省 = 纯气泡（无高亮目标）。
interface TutorialStep {
  selector?: string;
  title: string;
  text: string;
}
interface TutorialTopic {
  title: string;
  icon: ReactNode;
  steps: TutorialStep[];
}

// 描边风格图标（与工具栏/属性面板图标同设计语言，不使用 emoji）
const svgProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true } as const;
const ICON_PENCIL = (
  <svg {...svgProps}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const ICON_BRUSH = (
  <svg {...svgProps}>
    <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
    <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
    <path d="M14.5 17.5 4.5 15" />
  </svg>
);
const ICON_ROBOT = (
  <svg {...svgProps}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4" />
    <circle cx="12" cy="3" r="1" />
    <path d="M8 13h.01M16 13h.01M8 17h8" />
  </svg>
);
const ICON_CHART = (
  <svg {...svgProps}>
    <path d="M3 3v18h18" />
    <path d="M7 15v3M12 11v7M17 7v11" />
  </svg>
);
const ICON_SAVE = (
  <svg {...svgProps}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);
const ICON_KEYBOARD = (
  <svg {...svgProps}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
  </svg>
);

const TOPICS: TutorialTopic[] = [
  {
    title: "基础绘图",
    icon: ICON_PENCIL,
    steps: [
      { selector: '[title="选择"]', title: "选择工具", text: "这是选择工具：点它切换到选择模式，然后在画布上点选、拖动元素试试。" },
      { selector: '[title="图形"]', title: "图形工具", text: "点「图形」按钮展开图案面板，选一个形状（如矩形），再到画布上拖拽画出来。" },
      { selector: '[title="文本框"]', title: "文本框", text: "点「文本」按钮，到画布上拖出一个文本框直接打字。画完按 Ctrl+Z 可撤销。" },
      { title: "完成！", text: "基础绘图你已上手。试试选中元素按 Delete 删除、Ctrl+D 复制、WASD 平移画布。" },
    ],
  },
  {
    title: "画笔",
    icon: ICON_BRUSH,
    steps: [
      { selector: '[title="画笔"]', title: "画笔工具", text: "点「画笔」按钮，右侧会弹出颜色与粗细设置面板。" },
      { selector: '[data-testid="pen-settings"]', title: "颜色与粗细", text: "在这里选颜色、拖动粗细滑杆，下方有粗细预览。然后在画布上自由手绘。" },
      { title: "手写识别", text: "手写一个箭头（杆 + 尖），停顿一下看到替代预览，松手自动变成规整箭头；继续写会重新计算。" },
    ],
  },
  {
    title: "AI 助手",
    icon: ICON_ROBOT,
    steps: [
      { selector: "#chat-input", title: "AI 聊天输入框", text: "在这里输入描述，比如「画一个神经网络架构图」，然后点「一键生成」。" },
      { title: "AI 提问与搜索", text: "AI 提问时点选项按钮即可回答；需要权威数据时会通过本地 SearXNG + Crawl4AI 检索并保留来源。生成中可继续操作画布。" },
    ],
  },
  {
    title: "图表与数据",
    icon: ICON_CHART,
    steps: [
      { selector: '[title="图表"]', title: "图表工具", text: "点「图表」按钮打开生成对话框：选类型（柱状/折线/饼/散点），填数据即生成。" },
      { title: "编辑图表", text: "选中图表后拖扇形/柱顶可直接改数值；图表是整体图对象，可整体移动、编辑数据、解除关联。" },
    ],
  },
  {
    title: "导出与保存",
    icon: ICON_SAVE,
    steps: [
      { selector: '[title="导出"]', title: "导出", text: "点「导出」选 SVG（矢量）或 PNG（超清），PNG 可勾选含背景与选分辨率。" },
      { title: "自动保存", text: "画布/对话/设置会自动落盘到项目 data/ 目录；设置里可一键在文件夹中打开。刷新页面不丢数据。" },
    ],
  },
  {
    title: "快捷键速查",
    icon: ICON_KEYBOARD,
    steps: [
      { title: "常用快捷键", text: "Delete 删除选中；Ctrl+Z / Ctrl+Y 撤销重做；Ctrl+D 复制；WASD 平移画布；Shift 多选；双击文字编辑。" },
      { title: "时间线", text: "撤销/重做按钮中间的时间线按钮：点击弹出进度条，拖动可快速跳转到任意历史版本。" },
    ],
  },
];

// 教学功能：点击左下角问号 → 先选教学方面 → 进入页面引导模式：
// 真实元素高亮（聚焦）+ 磨砂玻璃气泡标注，点击目标后自动进入下一步。
export default function TutorialLauncher() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<TutorialTopic | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);
  if (typeof document === "undefined") return null;

  const step = topic?.steps[stepIdx];

  // 测量目标元素位置（持续轮询：面板展开/布局变化后仍跟随）
  useEffect(() => {
    if (!topic || !step?.selector) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const loop = () => {
      measure();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [topic, stepIdx, step?.selector]);

  // 点击推进：命中当前高亮目标（或其子元素）→ 下一步；最后一步后点击任意处完成
  useEffect(() => {
    if (!topic) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (stepIdx >= topic.steps.length - 1) {
        // 最后一步（纯气泡/完成提示）：点任意处结束引导
        setTopic(null);
        setStepIdx(0);
        return;
      }
      const sel = topic.steps[stepIdx].selector;
      if (sel && t.closest(sel)) {
        setStepIdx((i) => i + 1);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [topic, stepIdx]);

  const closeAll = useCallback(() => {
    setOpen(false);
    setTopic(null);
    setStepIdx(0);
  }, []);

  // 教学气泡：固定在视口顶部居中——置顶永远可见（不会被工具栏/面板遮住），
  // 且与被高亮的目标按钮分离（目标在左坞/画布/右侧面板，顶部中央是安全区），避免遮挡
  const bubbleStyle: React.CSSProperties = {
    left: "50%",
    top: 16,
    transform: "translateX(-50%)",
    maxWidth: "min(22rem, calc(100vw - 2rem))",
  };

  return (
    <>
      {/* 左下角悬浮入口：与左侧工具坞同款玻璃风格 */}
      <button
        type="button"
        title="使用技巧"
        aria-label="使用技巧"
        onClick={() => {
          if (open && !topic) setOpen(false);
          else if (open && topic) closeAll();
          else setOpen(true);
        }}
        className="lift fixed bottom-4 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white/75 text-base font-bold text-blue-600 shadow-xl backdrop-blur-xl hover:bg-white/90"
      >
        ?
      </button>

      {/* 选择教学方面：非阻塞小浮窗（不遮罩画布） */}
      {open &&
        !topic &&
        createPortal(
          <div className="fixed bottom-16 left-4 z-50 w-72 overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-2xl backdrop-blur-xl" data-testid="tutorial-dialog">
            <div className="flex items-center justify-between border-b border-white/60 px-3 py-2">
              <h2 className="text-sm font-semibold text-gray-800">选择教学方面</h2>
              <button title="关闭" aria-label="关闭使用技巧" onClick={() => setOpen(false)} className="lift flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {TOPICS.map((t) => (
                <button
                  key={t.title}
                  type="button"
                  onClick={() => { setTopic(t); setStepIdx(0); }}
                  className="lift flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-white/80"
                >
                  <span className="shrink-0">{t.icon}</span>
                  <span className="flex-1">{t.title}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">▸</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* 引导模式：聚焦高亮目标元素 + 磨砂玻璃气泡，点击目标进入下一步。
          容器必须 pointer-events-none 让点击穿透到被高亮的真实按钮；气泡单独恢复交互（退出按钮可点） */}
      {topic &&
        step &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[70]" data-testid="tutorial-guide">
            {/* 周围变暗：高亮框外打大阴影形成聚焦（pointer-events 透传给目标） */}
            {rect && (
              <div
                className="pointer-events-none fixed rounded-2xl border-2 border-blue-400 ring-4 ring-blue-300/40 transition-all duration-200"
                style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.38)" }}
              />
            )}
            {!rect && step.selector && (
              <div className="pointer-events-none fixed inset-0 bg-slate-900/30" />
            )}
            {/* 磨砂玻璃气泡（容器 pointer-events-none，气泡单独恢复交互以便退出按钮可点） */}
            <div
              className="pointer-events-auto fixed w-64 rounded-2xl border border-white/50 bg-white/80 p-4 shadow-2xl backdrop-blur-xl"
              style={bubbleStyle}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">{stepIdx + 1}</span>
                <span className="text-sm font-semibold text-gray-800">{step.title}</span>
              </div>
              <p className="text-xs leading-relaxed text-gray-600">{step.text}</p>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={closeAll}
                  className="lift rounded-lg border border-white/60 bg-white/70 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-white/90"
                >
                  退出
                </button>
                <span className="text-[10px] text-gray-400">
                  {step.selector ? "点击高亮位置继续 →" : "点任意处完成"}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
