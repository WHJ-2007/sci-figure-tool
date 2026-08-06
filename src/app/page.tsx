"use client";

import Toolbar from "@/components/editor/Toolbar";
import Canvas from "@/components/editor/Canvas";
import PropertyPanel from "@/components/editor/PropertyPanel";
import ChatPanel from "@/components/editor/ChatPanel";
import EditorHost from "@/components/editor/EditorHost";
import FirstRunHint from "@/components/editor/FirstRunHint";
import GenerationToast from "@/components/editor/GenerationToast";
import AutoSave from "@/components/editor/AutoSave";

export default function Home() {
  return (
    <EditorHost>
      <main className="flex h-full w-full flex-col">
        <Toolbar />
        <FirstRunHint />
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="min-w-0 flex-1">
            <Canvas viewportWidth={1200} viewportHeight={800} />
          </div>
          {/* 右侧：两张独立悬浮的亚克力卡片（属性 / AI 助手），与画布玻璃面板同语言 */}
          <div className="flex w-72 shrink-0 flex-col gap-3">
            <div className="glass-panel max-h-[45%] overflow-y-auto">
              <PropertyPanel />
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
