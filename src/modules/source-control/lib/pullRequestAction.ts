import type { GitStatusSnapshot } from "@/lib/native";

export type PullRequestUpstream = {
  remote: string;
  branch: string;
};

export function pullRequestUpstreamCandidates(
  upstream: string | null,
): PullRequestUpstream[] {
  if (
    !upstream ||
    /\s/.test(upstream) ||
    upstream.startsWith("/") ||
    upstream.endsWith("/") ||
    upstream.includes("//")
  ) {
    return [];
  }

  const candidates: PullRequestUpstream[] = [];
  for (
    let slash = upstream.lastIndexOf("/");
    slash > 0;
    slash = upstream.lastIndexOf("/", slash - 1)
  ) {
    candidates.push({
      remote: upstream.slice(0, slash),
      branch: upstream.slice(slash + 1),
    });
  }
  return candidates;
}

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
