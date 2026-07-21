import { describe, expect, it } from "vitest";
import {
  inspectCommit,
  returnToGraph,
  type HistoryView,
} from "@/modules/git-history/lib/historyView";

describe("history view transitions", () => {
  it("opens a selected commit in the inspector", () => {
    expect(inspectCommit("abc123")).toEqual({ kind: "inspect", sha: "abc123" });
  });

  it("returns to graph mode", () => {
    const view: HistoryView = { kind: "inspect", sha: "abc123" };
    expect(returnToGraph(view)).toEqual({ kind: "graph" });
  });
});
