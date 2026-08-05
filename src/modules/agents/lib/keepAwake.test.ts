import { describe, expect, it } from "vitest";
import {
  KEEP_AWAKE_STALE_AFTER_MS,
  keepAwakeEligible,
  nextStaleDeadline,
} from "./keepAwake";
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

  it("ignores sessions stuck working past the stale cap", () => {
    const now = KEEP_AWAKE_STALE_AFTER_MS + 1000;
    expect(keepAwakeEligible([session({ lastActivityAt: 0 })], true, now)).toBe(
      false,
    );
    expect(
      keepAwakeEligible([session({ lastActivityAt: 1000 })], true, now),
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
