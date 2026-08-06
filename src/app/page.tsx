"use client";

import Toolbar from "@/components/editor/Toolbar";
import Canvas from "@/components/editor/Canvas";
import PropertyPanel from "@/components/editor/PropertyPanel";
import ChatPanel from "@/components/editor/ChatPanel";
import EditorHost from "@/components/editor/EditorHost";
import FirstRunHint from "@/components/editor/FirstRunHint";
import GenerationToast from "@/components/editor/GenerationToast";
import AutoSave from "@/components/editor/AutoSave";
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
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="min-w-0 flex-1">
            <Canvas viewportWidth={1200} viewportHeight={800} />
          </div>
          {/* 右侧：两张独立悬浮的亚克力卡片（属性 / AI 助手），与画布玻璃面板同语言。
              属性面板用 grid-template-rows 0fr↔1fr 过渡实现高度动画（内容溢出时内层滚动）；
              AI 面板 flex-1 占满剩余空间，随属性面板同步伸缩 */}
          <div className="flex w-72 shrink-0 flex-col gap-3">
            <div
              className={`glass-panel grid transition-[grid-template-rows,opacity,border-color] duration-300 ease-out ${
                hasSelection ? "max-h-[70%] grid-rows-[1fr] border-white/60" : "grid-rows-[0fr] border-transparent opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-y-auto">
                <PropertyPanel />
              </div>
            </div>
            <div className="glass-panel min-h-0 flex-1 overflow-hidden">
              <ChatPanel />
            </div>
          </div>
        </div>
      </main>
      <GenerationToast />
      <AutoSave />
    </EditorHost>
  );
}
