import { describe, expect, it } from "vitest";
import { planProjectTabsRemoval, type Tab } from "./useTabs";

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

describe("planProjectTabsRemoval", () => {
  it("drops every owned tab and returns terminal leaves to dispose", () => {
    const tabs = [term(1, "project-a"), term(2, "project-a"), term(3, "project-b")];
    const plan = planProjectTabsRemoval(tabs, ["project-a"], 1);

    expect(plan.tabs.map((tab) => tab.id)).toEqual([3]);
    expect(plan.disposeLeafIds).toEqual([10, 20]);
    expect(plan.activeId).toBeNull();
  });

  it("preserves tabs in other Projects and their active selection", () => {
    const tabs = [term(1, "project-a"), term(2, "project-b"), term(3, "project-b")];
    const plan = planProjectTabsRemoval(tabs, ["project-a"], 3);

    expect(plan.tabs).toEqual([tabs[1], tabs[2]]);
    expect(plan.activeId).toBe(3);
  });

  it("accepts empty Projects without changing tabs", () => {
    const tabs = [term(1, "project-a")];
    expect(planProjectTabsRemoval(tabs, ["project-b"], 1)).toEqual({
      tabs,
      disposeLeafIds: [],
      activeId: 1,
    });
  });
});
