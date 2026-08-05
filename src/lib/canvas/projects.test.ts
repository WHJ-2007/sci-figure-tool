import { describe, it, expect, beforeEach } from "vitest";
import { loadProjects, saveProjects, makeProject, defaultProjectName } from "./projects";

beforeEach(() => localStorage.clear());

describe("projects 持久化", () => {
  it("saveProjects/loadProjects 往返保留 id/name/doc，history 不入存储", () => {
    const p = makeProject("画布 1");
    p.doc.elements.push({ id: "e1", type: "rect", x: 0, y: 0, width: 10, height: 10, rotation: 0, fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 1, zIndex: 0, rx: 0 });
    p.history.past.push(p.doc);
    saveProjects([p]);
    const loaded = loadProjects()!;
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(p.id);
    expect(loaded[0].name).toBe("画布 1");
    expect(loaded[0].doc.elements).toHaveLength(1);
    // 存储里不含 history（load 后 history 为空）
    expect(loaded[0].history.past).toHaveLength(0);
    const raw = JSON.parse(localStorage.getItem("sci-figure.projects.v1")!);
    expect(raw[0]).not.toHaveProperty("history");
  });

  it("无数据 / 损坏 JSON / 空数组时返回 null", () => {
    expect(loadProjects()).toBeNull();
    localStorage.setItem("sci-figure.projects.v1", "{oops");
    expect(loadProjects()).toBeNull();
    localStorage.setItem("sci-figure.projects.v1", "[]");
    expect(loadProjects()).toBeNull();
  });

  it("defaultProjectName 按现有最大序号递增", () => {
    const a = makeProject("画布 1");
    const b = makeProject("画布 3");
    const c = makeProject("流程图");
    expect(defaultProjectName([a, b, c])).toBe("画布 4");
    expect(defaultProjectName([c])).toBe("画布 1");
  });
});
