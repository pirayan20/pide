import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@/lib/native";
import {
  canOfferCreatePullRequest,
  parsePullRequestUpstream,
} from "@/modules/source-control/lib/pullRequestAction";

const eligibleStatus: GitStatusSnapshot = {
  repoRoot: "/repo",
  branch: "feat/create-pr",
  upstream: "origin/feat/create-pr",
  ahead: 0,
  behind: 0,
  isDetached: false,
  truncated: false,
  changedFiles: [],
};

describe("parsePullRequestUpstream", () => {
  it("splits remote and branch at the first slash", () => {
    expect(parsePullRequestUpstream("upstream/feat/create-pr")).toEqual({
      remote: "upstream",
      branch: "feat/create-pr",
    });
  });

  it.each([
    null,
    "",
    "origin",
    "/main",
    "origin/",
    "origin/feat branch",
  ])("rejects invalid upstream %j", (upstream) => {
    expect(parsePullRequestUpstream(upstream)).toBeNull();
  });
});

describe("canOfferCreatePullRequest", () => {
  it("accepts a clean attached synchronized branch", () => {
    expect(canOfferCreatePullRequest(true, eligibleStatus)).toBe(true);
  });

  it("rejects a missing repository", () => {
    expect(canOfferCreatePullRequest(false, eligibleStatus)).toBe(false);
  });

  it("rejects changed files", () => {
    expect(
      canOfferCreatePullRequest(true, {
        ...eligibleStatus,
        changedFiles: [
          {
            path: "src/index.ts",
            originalPath: null,
            indexStatus: " ",
            worktreeStatus: "M",
            staged: false,
            unstaged: true,
            untracked: false,
            statusLabel: "Modified",
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a detached HEAD", () => {
    expect(
      canOfferCreatePullRequest(true, { ...eligibleStatus, isDetached: true }),
    ).toBe(false);
  });

  it("rejects an empty branch", () => {
    expect(
      canOfferCreatePullRequest(true, { ...eligibleStatus, branch: "" }),
    ).toBe(false);
  });

  it("rejects a missing upstream", () => {
    expect(
      canOfferCreatePullRequest(true, { ...eligibleStatus, upstream: null }),
    ).toBe(false);
  });

  it("rejects commits ahead of upstream", () => {
    expect(
      canOfferCreatePullRequest(true, { ...eligibleStatus, ahead: 1 }),
    ).toBe(false);
  });

  it("rejects commits behind upstream", () => {
    expect(
      canOfferCreatePullRequest(true, { ...eligibleStatus, behind: 1 }),
    ).toBe(false);
  });
});
