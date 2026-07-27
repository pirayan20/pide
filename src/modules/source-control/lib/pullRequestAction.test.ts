import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@/lib/native";
import {
  canOfferCreatePullRequest,
  canOfferPublishBranch,
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

describe("canOfferPublishBranch", () => {
  const unpublishedStatus: GitStatusSnapshot = {
    ...eligibleStatus,
    upstream: null,
  };

  it("accepts an attached branch without an upstream", () => {
    expect(canOfferPublishBranch(true, unpublishedStatus)).toBe(true);
  });

  it("accepts uncommitted changes on an unpublished branch", () => {
    expect(
      canOfferPublishBranch(true, {
        ...unpublishedStatus,
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
    ).toBe(true);
  });

  it("rejects a branch that already has an upstream", () => {
    expect(canOfferPublishBranch(true, eligibleStatus)).toBe(false);
  });

  it("rejects a missing repository", () => {
    expect(canOfferPublishBranch(false, unpublishedStatus)).toBe(false);
  });

  it("rejects a detached HEAD", () => {
    expect(
      canOfferPublishBranch(true, { ...unpublishedStatus, isDetached: true }),
    ).toBe(false);
  });

  it("rejects an empty branch", () => {
    expect(
      canOfferPublishBranch(true, { ...unpublishedStatus, branch: "" }),
    ).toBe(false);
  });
});
