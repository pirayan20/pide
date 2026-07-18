import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  computeGitQuickDiff,
  rematchActiveHunk,
  type GitQuickDiffHunk,
} from "./gitQuickDiff";

const doc = (value: string) => Text.of(value.split("\n"));

function summary(hunks: readonly GitQuickDiffHunk[]) {
  return hunks.map(({ layer, kind, startLine, endLine }) => ({
    layer,
    kind,
    startLine,
    endLine,
  }));
}

describe("computeGitQuickDiff", () => {
  it("classifies an added live range", () => {
    expect(summary(computeGitQuickDiff("a", "a", doc("a\nb")))).toEqual([
      { layer: "primary", kind: "added", startLine: 2, endLine: 2 },
    ]);
  });

  it("classifies a modified live range", () => {
    expect(summary(computeGitQuickDiff("a", "a", doc("b")))).toEqual([
      { layer: "primary", kind: "modified", startLine: 1, endLine: 1 },
    ]);
  });

  it("classifies text inserted within a line as modified", () => {
    const hunks = computeGitQuickDiff("line", "line", doc("line changed"));
    expect(summary(hunks)).toEqual([
      { layer: "primary", kind: "modified", startLine: 1, endLine: 1 },
    ]);
    expect(hunks[0].removedText).toBe("line");
  });

  it("classifies a deleted baseline range", () => {
    const hunks = computeGitQuickDiff("a\nb", "a\nb", doc("a"));
    expect(summary(hunks)).toEqual([
      { layer: "primary", kind: "deleted", startLine: 1, endLine: 1 },
    ]);
    expect(hunks[0].removedText).toBe("b");
  });

  it("keeps staged hunks hollow and non-overlapping unstaged hunks solid", () => {
    const hunks = computeGitQuickDiff(
      "one\nmiddle\nthree",
      "ONE\nmiddle\nthree",
      doc("ONE\nmiddle\nTHREE"),
    );
    expect(summary(hunks)).toEqual([
      { layer: "secondary", kind: "modified", startLine: 1, endLine: 1 },
      { layer: "primary", kind: "modified", startLine: 3, endLine: 3 },
    ]);
  });

  it("suppresses a secondary hunk that touches a primary hunk", () => {
    const hunks = computeGitQuickDiff("a", "b", doc("c"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0].layer).toBe("primary");
  });

  it("places a deletion at the nearest surviving line", () => {
    const hunks = computeGitQuickDiff("a\nb\nc", "a\nb\nc", doc("a\nc"));
    expect(summary(hunks)).toEqual([
      { layer: "primary", kind: "deleted", startLine: 2, endLine: 2 },
    ]);
    expect(hunks[0].removedText).toBe("b");
  });
});

describe("rematchActiveHunk", () => {
  it("follows a hunk shifted by lines inserted above it", () => {
    const baseline = "a\n1\n2\n3\n4\nb";
    const before = computeGitQuickDiff(
      baseline,
      baseline,
      doc("a\n1\n2\n3\n4\nB"),
    )[0];
    const after = computeGitQuickDiff(
      baseline,
      baseline,
      doc("new\na\n1\n2\n3\n4\nB"),
    );
    expect(rematchActiveHunk(before, after)?.startLine).toBe(7);
  });

  it("returns null when the active change disappears", () => {
    const before = computeGitQuickDiff("a", "a", doc("b"))[0];
    expect(rematchActiveHunk(before, [])).toBeNull();
  });
});
