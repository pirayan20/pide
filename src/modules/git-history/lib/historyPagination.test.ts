import { describe, expect, it } from "vitest";
import {
  canLoadMore,
  isCurrentHistoryRequest,
  snapshotHistoryPage,
} from "@/modules/git-history/lib/historyPagination";

describe("canLoadMore", () => {
  it("allows the initial pagination request and a retry", () => {
    expect(canLoadMore("idle", false, false)).toBe(true);
    expect(canLoadMore("error", false, false)).toBe(true);
  });

  it("blocks requests already in flight or after history ends", () => {
    expect(canLoadMore("idle", false, true)).toBe(false);
    expect(canLoadMore("error", true, false)).toBe(false);
  });
});

describe("snapshotHistoryPage", () => {
  it("pins continuation to the first loaded commit and exact loaded offset", () => {
    expect(snapshotHistoryPage([{ sha: "head" }, { sha: "next" }])).toEqual({
      startSha: "head",
      offset: 2,
    });
  });

  it("does not build a continuation request without a snapshot", () => {
    expect(snapshotHistoryPage([])).toBeNull();
  });
});

describe("isCurrentHistoryRequest", () => {
  it("accepts results from the current repository generation", () => {
    expect(isCurrentHistoryRequest(4, 4, "/repo", "/repo")).toBe(true);
  });

  it("rejects results after a refresh or repository change", () => {
    expect(isCurrentHistoryRequest(4, 5, "/repo", "/repo")).toBe(false);
    expect(isCurrentHistoryRequest(4, 4, "/old", "/new")).toBe(false);
  });
});
