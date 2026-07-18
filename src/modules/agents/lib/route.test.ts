import { describe, expect, it } from "vitest";
import { consumePendingAgentJump, recordPendingAgentJump } from "./route";

describe("pending agent jump", () => {
  it("returns the recorded target once, within the ttl", () => {
    recordPendingAgentJump(3, 7, 1_000);
    expect(consumePendingAgentJump(1_000 + 5_000)).toEqual({
      tabId: 3,
      leafId: 7,
    });
    expect(consumePendingAgentJump(1_000 + 5_000)).toBeNull();
  });

  it("expires after the ttl", () => {
    recordPendingAgentJump(3, 7, 1_000);
    expect(consumePendingAgentJump(1_000 + 91_000)).toBeNull();
  });
});
