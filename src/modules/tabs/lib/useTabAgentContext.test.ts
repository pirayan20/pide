import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import { useAgentActivityStore } from "@/modules/terminal/lib/agentActivity";
import { useLeafTitleStore } from "@/modules/terminal/lib/leafTitles";

const observed = vi.hoisted(() => ({ titleReads: [] as Array<() => unknown> }));

vi.mock("@/modules/terminal", async () => {
  const activity = await import("@/modules/terminal/lib/agentActivity");
  const titles = await import("@/modules/terminal/lib/leafTitles");
  const panes = await import("@/modules/terminal/lib/panes");
  return {
    leafIds: panes.leafIds,
    pickTabAgent: activity.pickTabAgent,
    ptyIdForLeaf: (id: number) => id,
    useAgentActivityStore: (
      select: (
        state: ReturnType<typeof activity.useAgentActivityStore.getState>,
      ) => unknown,
    ) => select(activity.useAgentActivityStore.getState()),
    useLeafTitleStore: (
      select: (
        state: ReturnType<typeof titles.useLeafTitleStore.getState>,
      ) => unknown,
    ) => {
      const read = () => select(titles.useLeafTitleStore.getState());
      observed.titleReads.push(read);
      return read();
    },
  };
});

import { useTabAgentContext } from "@/modules/tabs/lib/useTabAgentContext";

function tab(id: number, extra: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id,
    kind: "terminal",
    projectId: "test",
    title: "shell",
    paneTree: { kind: "leaf", id },
    activeLeafId: id,
    ...extra,
  };
}

function replayTitles(frames: number): number {
  let previous = observed.titleReads.map((read) => read());
  let invalidations = 0;
  for (let frame = 0; frame < frames; frame++) {
    useLeafTitleStore.getState().set(1, `Working ${frame}`);
    const next = observed.titleReads.map((read) => read());
    invalidations += next.filter(
      (value, i) => !Object.is(value, previous[i]),
    ).length;
    previous = next;
  }
  return invalidations;
}

describe("terminal title subscription scope", () => {
  beforeEach(() => {
    observed.titleReads = [];
    useLeafTitleStore.setState({ titles: {} });
    useAgentActivityStore.setState({ phases: {}, agents: {} });
  });

  it("updates only the changed label across 20 tabs and their icons", () => {
    for (let id = 1; id <= 20; id++) {
      useAgentActivityStore.getState().start(id, "claude");
      // biome-ignore lint/correctness/useHookAtTopLevel: mocked store hooks capture selectors without React rendering.
      useTabAgentContext(tab(id));
      // biome-ignore lint/correctness/useHookAtTopLevel: mocked store hooks capture selectors without React rendering.
      useTabAgentContext(tab(id), false);
    }
    expect(replayTitles(100)).toBe(100);
  });

  it("keeps the exact title and highest-priority split agent", () => {
    useAgentActivityStore.getState().start(1, "claude");
    useAgentActivityStore.getState().start(2, "codex");
    useAgentActivityStore.getState().setPhase(2, "attention");
    useLeafTitleStore.getState().set(2, "Permission needed");
    const split = tab(1, {
      paneTree: {
        kind: "split",
        id: 3,
        dir: "row",
        children: [
          { kind: "leaf", id: 1 },
          { kind: "leaf", id: 2 },
        ],
      },
    });
    expect(useTabAgentContext(split)).toEqual({
      name: "codex",
      oscTitle: "Permission needed",
    });
    expect(replayTitles(10)).toBe(0);
    useAgentActivityStore.getState().clear(2);
    expect(useTabAgentContext(split)?.name).toBe("claude");
  });

  it("ignores title animation for custom labels, private terminals and editors", () => {
    useAgentActivityStore.getState().start(1, "claude");
    useTabAgentContext(tab(1, { customTitle: "Server" }));
    useTabAgentContext(tab(1, { private: true }));
    useTabAgentContext({ id: 5, kind: "editor", title: "file.ts" } as Tab);
    expect(replayTitles(10)).toBe(0);
  });

  it("observes title removal and preserves icon identity", () => {
    useAgentActivityStore.getState().start(1, "claude");
    useLeafTitleStore.getState().set(1, "Working");
    expect(useTabAgentContext(tab(1), false)).toEqual({
      name: "claude",
      oscTitle: null,
    });
    expect(useTabAgentContext(tab(1))?.oscTitle).toBe("Working");
    useLeafTitleStore.getState().clear(1);
    expect(observed.titleReads[observed.titleReads.length - 1]()).toBeNull();
  });
});
