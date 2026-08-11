"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { saveProjectsToFile, ensureSavePermission } from "@/lib/canvas/saveTarget";

// 瞬时保存：画布/项目数据变化 → 防抖 500ms → 写入保存目录（全部画布一个文件）。
// 仅 projects 引用变化时触发（selection/view 变化不落盘）；浏览器重启后权限失效时自动重授权重存一次。
const DEBOUNCE_MS = 500;

export default function AutoSave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = useCanvasStore.getState().projects;
    const save = () => {
      timer = null;
      void (async () => {
        const slim = useCanvasStore.getState().projects.map(({ id, name, doc }) => ({ id, name, doc }));
        const json = JSON.stringify(slim);
        const r = await saveProjectsToFile(json);
        if (r === "denied" && (await ensureSavePermission())) {
          await saveProjectsToFile(json);
        }
        // 长期存储兜底：同步落盘到项目 data/ 目录（清浏览器缓存/换浏览器也可找回）
        try {
          await fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "canvas", json }),
          });
        } catch {
          // 落盘失败静默（localStorage 仍兜底）
        }
      })();
    };
    const unsub = useCanvasStore.subscribe((s) => {
      if (s.projects === last) return;
      last = s.projects;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
  return null;
}
