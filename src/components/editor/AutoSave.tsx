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
