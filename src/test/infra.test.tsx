import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Ping() {
  return <div>ping</div>;
}

describe("infra", () => {
  it("renders jsx in jsdom", () => {
    render(<Ping />);
    expect(screen.getByText("ping")).toBeInTheDocument();
  });
});
