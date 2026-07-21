import type { GitStatusSnapshot } from "@/lib/native";

export type PullRequestUpstream = {
  remote: string;
  branch: string;
};

export function parsePullRequestUpstream(
  upstream: string | null,
): PullRequestUpstream | null {
  if (!upstream) return null;
  const slash = upstream.indexOf("/");
  if (slash <= 0 || slash === upstream.length - 1) return null;
  const remote = upstream.slice(0, slash);
  const branch = upstream.slice(slash + 1);
  if (/\s/.test(remote) || /\s/.test(branch)) return null;
  return { remote, branch };
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
