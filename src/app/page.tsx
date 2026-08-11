"use client";

import Toolbar from "@/components/editor/Toolbar";
import Canvas from "@/components/editor/Canvas";
import PropertyPanel from "@/components/editor/PropertyPanel";
import ChatPanel from "@/components/editor/ChatPanel";
import EditorHost from "@/components/editor/EditorHost";
import FirstRunHint from "@/components/editor/FirstRunHint";
import AutoSave from "@/components/editor/AutoSave";
import TutorialLauncher from "@/components/editor/TutorialLauncher";
import { useCanvasStore } from "@/lib/canvas/store";

export default function Home() {
  // 选中元素 → 属性面板展开（grid 行 1fr 过渡动画），AI 窗口 flex-1 同步伸缩；
  // 取消选择播放反向（镜像）动画收起
  const hasSelection = useCanvasStore((s) => s.selection.length > 0);
  return (
    <EditorHost>
      <main className="flex h-full w-full flex-col">
        <Toolbar />
        <FirstRunHint />
        {/* 画布与右侧对话面板的间隙（gap-4 = 16px）与左侧坞收起状态对称：
            左侧坞 fixed left-4 宽约 50px（右边缘 ≈ 66px），画布容器左留白 82px = 66 + 16，
            使坞右边缘到画布的距离与右侧栏到画布的距离（16px）一致；坞悬停展开为悬浮层覆盖画布 */}
        <div className="flex min-h-0 flex-1 gap-4 py-3 pl-[82px] pr-3">
          <div className="min-w-0 flex-1">
            <Canvas viewportWidth={1200} viewportHeight={800} />
          </div>
          {/* 右侧：两张独立悬浮的亚克力卡片（属性 / AI 助手），与画布玻璃面板同语言。
              属性面板用 grid-template-rows 0fr↔1fr + 上浮淡入/下沉淡出过渡实现高度与衔接动画
              （内容溢出时内层滚动）；AI 面板 flex-1 占满剩余空间，随属性面板平滑伸缩。
              mt-2/mb-2 = 上下各内缩 8px，与画布玻璃面板的 inset-2（8px）包边严格对齐：
              右侧栏上边界（含 glass-panel 外边框）与画布上边界（含 glass-canvas 外边框）同高 */}
          <div className="mt-2 mb-2 flex w-[22rem] shrink-0 flex-col gap-3">
            <div
              className={`glass-panel grid overflow-hidden transition-[grid-template-rows,opacity,transform,border-color] duration-300 ease-out ${
                hasSelection ? "max-h-[70%] translate-y-0 grid-rows-[1fr] border-white/60 opacity-100" : "translate-y-1.5 grid-rows-[0fr] border-transparent opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-y-auto">
                <PropertyPanel />
              </div>
            </div>
            <div className="glass-panel min-h-0 flex-1 overflow-hidden transition-[opacity,transform] duration-300 ease-out">
              <ChatPanel />
            </div>
          </div>
        </div>
      </main>
      <AutoSave />
      <TutorialLauncher />
    </EditorHost>
  );
}
