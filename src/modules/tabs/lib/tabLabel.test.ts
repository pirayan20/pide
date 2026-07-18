import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai", customTitle: "Server" })),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("labelFor (agent context)", () => {
  const tab = () => terminalTab({ cwd: "/Users/me/projects/terax-ai" });

  it("uses the agent baseline when there is no useful osc title", () => {
    expect(labelFor(tab(), { name: "claude" })).toBe("Claude Code - terax-ai");
    expect(labelFor(tab(), { name: "pi", oscTitle: null })).toBe(
      "Pi - terax-ai",
    );
  });

  it("prefers a useful agent osc title", () => {
    expect(labelFor(tab(), { name: "claude", oscTitle: "Fix flaky tests" })).toBe(
      "Fix flaky tests",
    );
  });

  it("rejects trivial osc titles (cwd, folder, shells, paths)", () => {
    for (const t of [
      "terax-ai",
      "/Users/me/projects/terax-ai",
      "~/projects/terax-ai",
      "zsh",
      "  ",
    ]) {
      expect(labelFor(tab(), { name: "claude", oscTitle: t })).toBe(
        "Claude Code - terax-ai",
      );
    }
  });

  it("custom title still wins over any agent context", () => {
    expect(
      labelFor(terminalTab({ cwd: "/x/y", customTitle: "Server" }), {
        name: "claude",
        oscTitle: "Doing things",
      }),
    ).toBe("Server");
  });

  it("no agent context reverts to the folder label", () => {
    expect(labelFor(tab())).toBe("terax-ai");
    expect(labelFor(tab(), null)).toBe("terax-ai");
  });
});
