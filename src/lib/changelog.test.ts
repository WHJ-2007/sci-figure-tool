import { describe, it, expect } from "vitest";
import { CHANGELOG } from "./changelog";

describe("changelog", () => {
  it("版本时间倒序排列", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i].time <= CHANGELOG[i - 1].time).toBe(true);
    }
  });
  it("每个版本都有变更条目", () => {
    for (const v of CHANGELOG) {
      expect(v.changes.length).toBeGreaterThan(0);
    }
  });
});
