import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import FirstRunHint from "./FirstRunHint";
import { saveSettings } from "@/lib/settings";

beforeEach(() => localStorage.clear());

describe("FirstRunHint", () => {
  it("未配置 Key 时显示引导", () => {
    render(<FirstRunHint />);
    expect(screen.getByText(/设置页/)).toBeInTheDocument();
  });

  it("已配置 Key 时不显示引导", () => {
    saveSettings({ apiKey: "test-key", model: "deepseek-chat", baseURL: "https://api.deepseek.com" });
    render(<FirstRunHint />);
    expect(screen.queryByText(/设置页/)).not.toBeInTheDocument();
  });
});
