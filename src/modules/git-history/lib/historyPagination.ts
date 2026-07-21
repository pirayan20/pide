export function canLoadMore(
  status: "idle" | "error",
  endReached: boolean,
  inFlight: boolean,
): boolean {
  return !endReached && !inFlight && (status === "idle" || status === "error");
}

export function isCurrentHistoryRequest(
  requestId: number,
  currentRequestId: number,
  requestRepoRoot: string,
  currentRepoRoot: string,
): boolean {
  return requestId === currentRequestId && requestRepoRoot === currentRepoRoot;
}
