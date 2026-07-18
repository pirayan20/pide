import { describe, expect, it } from "vitest";
import { pickTabByProjectIndex, type Tab } from "./useTabs";

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

describe("pickTabByProjectIndex", () => {
  const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];

  it("Cmd+1 in Project B returns B's first tab, not A's", () => {
    const tab = pickTabByProjectIndex(tabs, 0, "b");
    expect(tab?.id).toBe(2);
    expect(tab?.projectId).toBe("b");
  });

  it("Cmd+2 in Project B returns B's second tab", () => {
    expect(pickTabByProjectIndex(tabs, 1, "b")?.id).toBe(3);
  });

  it("Cmd+3 in Project B returns undefined (does nothing)", () => {
    expect(pickTabByProjectIndex(tabs, 2, "b")).toBeUndefined();
  });

  it("Cmd+1 in Project A returns A's only tab", () => {
    expect(pickTabByProjectIndex(tabs, 0, "a")?.id).toBe(1);
  });

  it("returns undefined for an empty Project", () => {
    expect(pickTabByProjectIndex(tabs, 0, "c")).toBeUndefined();
  });
});
