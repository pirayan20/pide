import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  gitOverviewMarkerMetrics,
  gitOverviewMetrics,
  gitOverviewScrollTop,
  gitQuickDiffExtension,
  readGitQuickDiffState,
  recomputeGitQuickDiff,
  setGitQuickDiffBaselines,
  toggleGitQuickDiffHunk,
} from "./gitQuickDiffExtension";

describe("Git overview scrollbar", () => {
  it("sizes overview markers from the complete CodeMirror layout span", () => {
    expect(gitOverviewMarkerMetrics(120, 320, 800)).toEqual({
      topPercent: 15,
      heightPercent: 25,
    });
  });

  it("keeps zero-length deletion markers at their layout anchor", () => {
    expect(gitOverviewMarkerMetrics(120, 120, 800)).toEqual({
      topPercent: 15,
      heightPercent: 0,
    });
  });

  it("clamps overview marker ranges to the document", () => {
    expect(gitOverviewMarkerMetrics(900, 1100, 1000)).toEqual({
      topPercent: 90,
      heightPercent: 10,
    });
  });

  it("sizes and positions the viewport thumb", () => {
    expect(gitOverviewMetrics(375, 1000, 250)).toEqual({
      thumbTopPercent: 37.5,
      thumbHeightPercent: 25,
    });
    expect(gitOverviewMetrics(0, 100, 100)).toEqual({
      thumbTopPercent: 0,
      thumbHeightPercent: 100,
    });
  });

  it("centers track clicks and clamps at both ends", () => {
    expect(gitOverviewScrollTop(0, 1000, 250)).toBe(0);
    expect(gitOverviewScrollTop(0.5, 1000, 250)).toBe(375);
    expect(gitOverviewScrollTop(1, 1000, 250)).toBe(750);
  });
});

describe("gitQuickDiffExtension", () => {
  it("loads baselines and computes visible hunks", () => {
    let state = EditorState.create({
      doc: "ONE\nmiddle\nTHREE",
      extensions: gitQuickDiffExtension(),
    });
    state = state.update({
      effects: setGitQuickDiffBaselines.of({
        repoRoot: "/repo",
        headContent: "one\nmiddle\nthree",
        indexContent: "ONE\nmiddle\nthree",
      }),
    }).state;
    expect(readGitQuickDiffState(state).hunks.map((h) => h.layer)).toEqual([
      "secondary",
      "primary",
    ]);
  });

  it("keeps only one active hunk and clears it when resolved", () => {
    let state = EditorState.create({
      doc: "b",
      extensions: gitQuickDiffExtension(),
    });
    state = state.update({
      effects: setGitQuickDiffBaselines.of({
        repoRoot: "/repo",
        headContent: "a",
        indexContent: "a",
      }),
    }).state;
    const id = readGitQuickDiffState(state).hunks[0].id;
    state = state.update({ effects: toggleGitQuickDiffHunk.of(id) }).state;
    expect(readGitQuickDiffState(state).active?.id).toBe(id);
    state = state.update({ changes: { from: 0, to: 1, insert: "a" } }).state;
    state = state.update({ effects: recomputeGitQuickDiff.of(null) }).state;
    expect(readGitQuickDiffState(state).active).toBeNull();
  });
});
