import { describe, expect, it } from "vitest";
import {
  KEEP_AWAKE_STALE_AFTER_MS,
  keepAwakeEligible,
  nextStaleDeadline,
} from "./keepAwake";
import { useAgentStore } from "../store/agentStore";
import type { AgentSession } from "./types";

function session(overrides: Partial<AgentSession>): AgentSession {
  return {
    leafId: 1,
    tabId: 1,
    agent: "claude",
    status: "working",
    startedAt: 0,
    lastActivityAt: 0,
    attentionSince: null,
    hookDriven: false,
    context: null,
    ...overrides,
  };
}

describe("keepAwakeEligible", () => {
  it("requires the preference to be enabled", () => {
    expect(
      keepAwakeEligible([session({ lastActivityAt: 100 })], false, 100),
    ).toBe(false);
    expect(
      keepAwakeEligible([session({ lastActivityAt: 100 })], true, 100),
    ).toBe(true);
  });

  it("ignores waiting sessions", () => {
    expect(
      keepAwakeEligible(
        [session({ status: "waiting", lastActivityAt: 100 })],
        true,
        100,
      ),
    ).toBe(false);
  });

  it("goes stale after the cap with no activity refresh", () => {
    const now = KEEP_AWAKE_STALE_AFTER_MS + 1000;
    expect(
      keepAwakeEligible([session({ lastActivityAt: 0 })], true, now),
    ).toBe(false);
  });

  it("stays eligible while the heartbeat refreshes activity", () => {
    // Simulates a long turn: heartbeat touches lastActivityAt while the pty
    // emits output. The cap must measure silence, not time since start.
    const touchedAt = 1000;
    expect(
      keepAwakeEligible(
        [session({ lastActivityAt: touchedAt })],
        true,
        KEEP_AWAKE_STALE_AFTER_MS + 500,
      ),
    ).toBe(true);
  });

  it("is false with no sessions", () => {
    expect(keepAwakeEligible([], true, 0)).toBe(false);
  });
});

describe("nextStaleDeadline", () => {
  it("returns the earliest working expiry", () => {
    const sessions = [
      session({ leafId: 1, lastActivityAt: 5000 }),
      session({ leafId: 2, lastActivityAt: 1000 }),
      session({ leafId: 3, status: "waiting", lastActivityAt: 0 }),
    ];
    expect(nextStaleDeadline(sessions, 10_000)).toBe(
      1000 + KEEP_AWAKE_STALE_AFTER_MS,
    );
  });

  it("skips already-expired sessions and returns null when none remain", () => {
    const now = KEEP_AWAKE_STALE_AFTER_MS + 10;
    expect(nextStaleDeadline([session({ lastActivityAt: 0 })], now)).toBe(null);
    expect(nextStaleDeadline([], 0)).toBe(null);
  });
});

describe("agentStore touch", () => {
  it("refreshes lastActivityAt for a working session", () => {
    useAgentStore.setState({ sessions: {} });
    useAgentStore.getState().start(7, 1, "claude");
    useAgentStore.getState().setStatus(7, "working");
    const before = useAgentStore.getState().sessions[7].lastActivityAt;
    useAgentStore.getState().touch(7);
    const after = useAgentStore.getState().sessions[7].lastActivityAt;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(useAgentStore.getState().sessions[7].status).toBe("working");
    useAgentStore.setState({ sessions: {} });
  });

  it("does not touch waiting sessions", () => {
    useAgentStore.setState({ sessions: {} });
    useAgentStore.getState().start(8, 1, "claude");
    useAgentStore.getState().setStatus(8, "waiting");
    const frozen = useAgentStore.getState().sessions[8].lastActivityAt;
    useAgentStore.getState().touch(8);
    expect(useAgentStore.getState().sessions[8].lastActivityAt).toBe(frozen);
    useAgentStore.setState({ sessions: {} });
  });

  it("ignores unknown leaves", () => {
    expect(() => useAgentStore.getState().touch(999)).not.toThrow();
  });
});
