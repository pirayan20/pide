export function canLoadMore(
  status: "idle" | "error",
  endReached: boolean,
  inFlight: boolean,
): boolean {
  return !endReached && !inFlight && (status === "idle" || status === "error");
}

export function snapshotHistoryPage(
  commits: ReadonlyArray<{ sha: string }>,
): { startSha: string; offset: number } | null {
  const snapshot = commits[0];
  return snapshot ? { startSha: snapshot.sha, offset: commits.length } : null;
}

export function isCurrentHistoryRequest(
  requestId: number,
  currentRequestId: number,
  requestRepoRoot: string,
  currentRepoRoot: string,
): boolean {
  return requestId === currentRequestId && requestRepoRoot === currentRepoRoot;
}
