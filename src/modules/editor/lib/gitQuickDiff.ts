import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";

export type GitQuickDiffLayer = "primary" | "secondary";
export type GitQuickDiffKind = "added" | "modified" | "deleted";

export type GitQuickDiffHunk = {
  id: string;
  layer: GitQuickDiffLayer;
  kind: GitQuickDiffKind;
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  baselineFrom: number;
  baselineTo: number;
  removedText: string;
  precise: boolean;
};

function buildLayer(
  baselineText: string,
  live: Text,
  layer: GitQuickDiffLayer,
): GitQuickDiffHunk[] {
  const baseline = Text.of(baselineText.split("\n"));
  return Chunk.build(baseline, live).map((chunk, index) => {
    const changes = chunk.changes.map((change) => ({
      fromA: chunk.fromA + change.fromA,
      toA: chunk.fromA + change.toA,
      fromB: chunk.fromB + change.fromB,
      toB: chunk.fromB + change.toB,
    }));
    const changedBaselineFrom = Math.min(
      ...changes.map((change) => change.fromA),
    );
    const changedBaselineTo = Math.min(
      baseline.length,
      Math.max(...changes.map((change) => change.toA)),
    );
    const liveFrom = Math.min(...changes.map((change) => change.fromB));
    const liveTo = Math.min(
      live.length,
      Math.max(...changes.map((change) => change.toB)),
    );
    const changedBaselineText = baseline.sliceString(
      changedBaselineFrom,
      changedBaselineTo,
    );
    const insertedText = live.sliceString(liveFrom, liveTo);
    const kind: GitQuickDiffKind =
      changedBaselineText.length === 0 &&
      (insertedText.includes("\n") || baseline.length === 0)
        ? "added"
        : insertedText.length === 0 &&
            (changedBaselineText.includes("\n") || live.length === 0)
          ? "deleted"
          : "modified";
    const baselineFrom =
      kind === "modified" ? chunk.fromA : changedBaselineFrom;
    const baselineTo =
      kind === "modified"
        ? Math.min(chunk.endA, baseline.length)
        : changedBaselineTo;
    const from =
      kind === "added" && insertedText.startsWith("\n")
        ? Math.min(liveFrom + 1, live.length)
        : liveFrom;
    const to = kind === "deleted" ? from : liveTo;
    const startLine = live.lineAt(from).number;
    const endLine = live.lineAt(Math.max(from, to - 1)).number;
    const removedText =
      kind === "added"
        ? ""
        : baseline
            .sliceString(baselineFrom, baselineTo)
            .replace(/^\n|\n$/g, "");
    return {
      id: `${layer}:${kind}:${index}:${from}:${to}:${removedText}`,
      layer,
      kind,
      from,
      to,
      startLine,
      endLine,
      baselineFrom,
      baselineTo,
      removedText,
      precise: chunk.precise,
    };
  });
}

function touches(a: GitQuickDiffHunk, b: GitQuickDiffHunk): boolean {
  return a.startLine <= b.endLine + 1 && b.startLine <= a.endLine + 1;
}

export function computeGitQuickDiff(
  headText: string,
  indexText: string,
  live: Text,
): GitQuickDiffHunk[] {
  const primary = buildLayer(indexText, live, "primary");
  const secondary = buildLayer(headText, live, "secondary").filter(
    (candidate) => !primary.some((hunk) => touches(candidate, hunk)),
  );
  const layerOrder = (layer: GitQuickDiffLayer) =>
    layer === "primary" ? 0 : 1;
  return [...primary, ...secondary].sort(
    (a, b) => a.from - b.from || layerOrder(a.layer) - layerOrder(b.layer),
  );
}

export function rematchActiveHunk(
  active: GitQuickDiffHunk,
  next: readonly GitQuickDiffHunk[],
): GitQuickDiffHunk | null {
  const compatible = next.filter(
    (hunk) => hunk.layer === active.layer && hunk.kind === active.kind,
  );
  return (
    compatible.find((hunk) => touches(active, hunk)) ??
    compatible
      .filter((hunk) => hunk.removedText === active.removedText)
      .sort(
        (a, b) =>
          Math.abs(a.startLine - active.startLine) -
          Math.abs(b.startLine - active.startLine),
      )[0] ??
    null
  );
}
