import { describe, expect, it } from "vitest";
import {
  agentLabelFromTitle,
  agentNameFromCommand,
  containsBrailleSpinner,
  detectAgentStatusFromTitle,
} from "./titleStatus";
import { titleTransitionEvents } from "./titleTracker";

describe("detectAgentStatusFromTitle", () => {
  it("treats any braille spinner frame as working, named or not", () => {
    expect(detectAgentStatusFromTitle("⠧ Fixing tests")).toBe("working");
    expect(detectAgentStatusFromTitle("⠋ jcode")).toBe("working");
  });

  it("recognizes Claude Code's idle prefix", () => {
    expect(detectAgentStatusFromTitle("✳ biome.json")).toBe("idle");
    expect(detectAgentStatusFromTitle("✳")).toBe("idle");
  });

  it("recognizes Gemini glyphs", () => {
    expect(detectAgentStatusFromTitle("✋ Gemini CLI")).toBe("permission");
    expect(detectAgentStatusFromTitle("✦ Gemini CLI")).toBe("working");
    expect(detectAgentStatusFromTitle("◇ Gemini CLI")).toBe("idle");
  });

  it("uses keywords only next to a known agent name", () => {
    expect(detectAgentStatusFromTitle("codex working")).toBe("working");
    expect(detectAgentStatusFromTitle("claude - action required")).toBe(
      "permission",
    );
    expect(detectAgentStatusFromTitle("aider ready")).toBe("idle");
    expect(detectAgentStatusFromTitle("server running")).toBe(null);
  });

  it("does not match agent names inside paths or compounds", () => {
    expect(detectAgentStatusFromTitle("~/claude-project")).toBe(null);
    expect(detectAgentStatusFromTitle("~/codex/ready")).toBe(null);
    expect(detectAgentStatusFromTitle("opencode-blinker")).toBe(null);
    expect(detectAgentStatusFromTitle("reworking claude-x")).toBe(null);
  });

  it("stays neutral on plain shell titles", () => {
    expect(detectAgentStatusFromTitle("~/dev/pide")).toBe(null);
    expect(detectAgentStatusFromTitle("vim src/main.rs")).toBe(null);
    expect(detectAgentStatusFromTitle("")).toBe(null);
  });
});

describe("agentLabelFromTitle", () => {
  it("names Claude from its status prefixes", () => {
    expect(agentLabelFromTitle("✳ some task")).toBe("Claude Code");
    expect(agentLabelFromTitle(". doing things")).toBe("Claude Code");
  });

  it("names agents from title tokens", () => {
    expect(agentLabelFromTitle("codex working on fix")).toBe("Codex");
    expect(agentLabelFromTitle("⠧ droid")).toBe("Droid");
    expect(agentLabelFromTitle("claude.exe thinking")).toBe("Claude Code");
  });

  it("returns null for anonymous spinner frames", () => {
    expect(agentLabelFromTitle("⠧ Fixing tests")).toBe(null);
  });
});

describe("agentNameFromCommand", () => {
  it("takes the first program token's basename", () => {
    expect(agentNameFromCommand("jcode --yes")).toBe("jcode");
    expect(agentNameFromCommand("/usr/local/bin/jcode chat")).toBe("jcode");
    expect(agentNameFromCommand("jcode.exe")).toBe("jcode");
  });

  it("skips flags, env assignments, runners, and shells", () => {
    expect(agentNameFromCommand("FOO=1 npx jcode")).toBe("jcode");
    expect(agentNameFromCommand("pnpm dlx some-agent --x")).toBe("some-agent");
    expect(agentNameFromCommand("sudo aider")).toBe("aider");
  });

  it("returns null when nothing looks like a program", () => {
    expect(agentNameFromCommand("")).toBe(null);
    expect(agentNameFromCommand("--help")).toBe(null);
  });
});

describe("titleTransitionEvents", () => {
  it("starts a session on first agent-shaped title", () => {
    expect(titleTransitionEvents(null, "working", false)).toEqual([
      { kind: "started", status: "working" },
    ]);
    expect(titleTransitionEvents(null, "idle", false)).toEqual([
      { kind: "started", status: "waiting" },
    ]);
  });

  it("reports completion only from working to idle", () => {
    expect(titleTransitionEvents("working", "idle", true)).toEqual([
      { kind: "finished" },
    ]);
    expect(titleTransitionEvents("permission", "idle", true)).toEqual([]);
  });

  it("asks for attention on entering permission", () => {
    expect(titleTransitionEvents("working", "permission", true)).toEqual([
      { kind: "attention" },
    ]);
    expect(titleTransitionEvents("idle", "permission", true)).toEqual([
      { kind: "attention" },
    ]);
  });

  it("resumes working silently", () => {
    expect(titleTransitionEvents("idle", "working", true)).toEqual([
      { kind: "working" },
    ]);
  });

  it("ignores null and repeated statuses", () => {
    expect(titleTransitionEvents("working", null, true)).toEqual([]);
    expect(titleTransitionEvents("working", "working", true)).toEqual([]);
    expect(titleTransitionEvents(null, null, false)).toEqual([]);
  });
});

describe("containsBrailleSpinner", () => {
  it("detects braille range codepoints only", () => {
    expect(containsBrailleSpinner("⠋")).toBe(true);
    expect(containsBrailleSpinner("plain")).toBe(false);
  });
});
