import { describe, it, expect } from "vitest";
import { CHANGELOG, APP_VERSION } from "./changelog";

describe("changelog", () => {
  it("已发行版本按时间倒序排列", () => {
    const released = CHANGELOG.filter((v) => v.sections.length > 0);
    for (let i = 1; i < released.length; i++) {
      expect(released[i].time <= released[i - 1].time).toBe(true);
    }
  });
  it("每个版本都有版本号与摘要", () => {
    for (const v of CHANGELOG) {
      expect(v.version.length).toBeGreaterThan(0);
      expect(v.summary.length).toBeGreaterThan(0);
    }
  });
  it("已发行版本每个一级标题都有二级标题与小内容", () => {
    for (const v of CHANGELOG) {
      if (v.sections.length === 0) continue; // 开发中占位允许为空
      expect(v.sections.length).toBeGreaterThan(0);
      for (const s of v.sections) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.subsections.length).toBeGreaterThan(0);
        for (const sub of s.subsections) {
          expect(sub.title.length).toBeGreaterThan(0);
          expect(sub.items.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it("APP_VERSION 为最新已发行版本", () => {
    const released = CHANGELOG.find((v) => v.sections.length > 0);
    expect(APP_VERSION).toBe(released?.version);
  });
});
