export type HistoryView = { kind: "graph" } | { kind: "inspect"; sha: string };

export function inspectCommit(sha: string): HistoryView {
  return { kind: "inspect", sha };
}

export function returnToGraph(_view: HistoryView): HistoryView {
  return { kind: "graph" };
}
