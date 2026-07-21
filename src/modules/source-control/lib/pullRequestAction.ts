import type { GitStatusSnapshot } from "@/lib/native";

export function canOfferCreatePullRequest(
  hasRepo: boolean,
  status: GitStatusSnapshot | null,
): boolean {
  if (!hasRepo || !status) return false;
  return (
    !!status.branch &&
    !status.isDetached &&
    !!status.upstream &&
    status.ahead === 0 &&
    status.behind === 0 &&
    status.changedFiles.length === 0
  );
}
