"use client";

import Toolbar from "@/components/editor/Toolbar";
import Canvas from "@/components/editor/Canvas";
import PropertyPanel from "@/components/editor/PropertyPanel";
import ChatPanel from "@/components/editor/ChatPanel";
import EditorHost from "@/components/editor/EditorHost";
import FirstRunHint from "@/components/editor/FirstRunHint";
import GenerationToast from "@/components/editor/GenerationToast";

export default function Home() {
  return (
    <EditorHost>
      <main className="flex h-full w-full flex-col">
        <Toolbar />
        <FirstRunHint />
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <Canvas viewportWidth={1200} viewportHeight={800} />
          </div>
          <div className="flex w-80 flex-col border-l border-white/40 bg-white/40 backdrop-blur-md">
            <div className="max-h-[45%] overflow-y-auto border-b border-white/40">
              <PropertyPanel />
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          </div>
        </div>
      </main>
      <GenerationToast />
    </EditorHost>
  );
}
