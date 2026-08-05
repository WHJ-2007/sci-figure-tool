"use client";

import { useShortcuts } from "./useShortcuts";

export default function EditorHost({ children }: { children?: React.ReactNode }) {
  useShortcuts();
  return <>{children}</>;
}
