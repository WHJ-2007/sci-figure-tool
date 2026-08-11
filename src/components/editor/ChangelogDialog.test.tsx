import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChangelogDialog from "./ChangelogDialog";

describe("更新日志", () => {
  it("所有条目默认折叠，重新打开后恢复折叠", async () => {
    const { rerender } = render(<ChangelogDialog open={true} onClose={vi.fn()} />);
    const sections = screen.getAllByRole("button", { expanded: false });
    expect(sections.length).toBeGreaterThan(1);

    fireEvent.click(sections[0]);
    expect(sections[0]).toHaveAttribute("aria-expanded", "true");

    rerender(<ChangelogDialog open={false} onClose={vi.fn()} />);
    rerender(<ChangelogDialog open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { expanded: false }).length).toBe(sections.length);
    });
  });
});
