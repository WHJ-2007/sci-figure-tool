import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("点击 × 关闭引导", () => {
    render(<FirstRunHint />);
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByText(/尚未配置/)).not.toBeInTheDocument();
  });
});
