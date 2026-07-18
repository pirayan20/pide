import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import { hasCloseBlocker, inspectCloseBlockers } from "./closeBlockers";

vi.mock("@/modules/terminal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/terminal")>();
  return {
    ...original,
    leafHasForegroundProcess: vi.fn(async (id: number) => id === 12),
  };
});

describe("inspectCloseBlockers", () => {
  it("counts dirty editors and checks every terminal leaf", async () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        projectId: "p1",
        title: "a.ts",
        path: "/repo/a.ts",
        dirty: true,
        preview: false,
      },
      {
        id: 2,
        kind: "terminal",
        projectId: "p1",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 10,
          dir: "row",
          children: [
            { kind: "leaf", id: 11 },
            { kind: "leaf", id: 12 },
          ],
        },
        activeLeafId: 11,
      },
    ];

    expect(await inspectCloseBlockers(tabs)).toEqual({
      dirtyEditors: 1,
      busyTerminal: true,
    });
  });
});

describe("hasCloseBlocker", () => {
  it("accepts only clean and idle groups", () => {
    expect(hasCloseBlocker({ dirtyEditors: 0, busyTerminal: false })).toBe(
      false,
    );
    expect(hasCloseBlocker({ dirtyEditors: 1, busyTerminal: false })).toBe(
      true,
    );
    expect(hasCloseBlocker({ dirtyEditors: 0, busyTerminal: true })).toBe(true);
  });
});
