import { describe, expect, it } from "vitest";
import { nextActiveInProject, type Tab } from "./useTabs";

function term(id: number, projectId: string): Tab {
  return {
    id,
    kind: "terminal",
    projectId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

describe("nextActiveInProject", () => {
  it("picks the previous tab within the same Project", () => {
    const tabs = [term(1, "a"), term(2, "a"), term(3, "a")];
    expect(nextActiveInProject(tabs, 3)).toBe(2);
    expect(nextActiveInProject(tabs, 2)).toBe(1);
  });

  it("falls forward when closing the first tab of a Project", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(nextActiveInProject(tabs, 1)).toBe(2);
  });

  it("never jumps into another Project", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    expect(nextActiveInProject(tabs, 2)).toBe(3);
    expect(nextActiveInProject(tabs, 3)).toBe(2);
  });

  it("returns null for the last tab of its Project", () => {
    const tabs = [term(1, "a"), term(2, "b")];
    expect(nextActiveInProject(tabs, 1)).toBeNull();
    expect(nextActiveInProject(tabs, 2)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nextActiveInProject([term(1, "a")], 99)).toBeNull();
  });
});
