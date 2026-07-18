import { describe, expect, it } from "vitest";
import { nextGitQuickDiffGeneration } from "./useGitQuickDiff";

describe("Git quick diff refresh coordination", () => {
  it("invalidates in-flight refreshes when the editor deactivates", () => {
    expect(nextGitQuickDiffGeneration(4, null)).toBe(5);
  });

  it("accepts Git changes until the editor repository is known", () => {
    expect(nextGitQuickDiffGeneration(4, null, "/repo")).toBe(5);
  });

  it("ignores Git changes from another known repository", () => {
    expect(nextGitQuickDiffGeneration(4, "/repo", "/other")).toBe(4);
  });
});
