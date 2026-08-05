"use client";

import Toolbar from "@/components/editor/Toolbar";
import Canvas from "@/components/editor/Canvas";
import PropertyPanel from "@/components/editor/PropertyPanel";
import ChatPanel from "@/components/editor/ChatPanel";
import EditorHost from "@/components/editor/EditorHost";

export default function Home() {
  return (
    <main className="flex h-full w-full flex-col">
      <EditorHost>
        <Toolbar />
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Canvas viewportWidth={1200} viewportHeight={800} />
        </div>
        <div className="flex w-80 flex-col border-l border-gray-200">
          <PropertyPanel />
          <ChatPanel />
        </div>
      </div>
      </EditorHost>
    </main>
  );
}
