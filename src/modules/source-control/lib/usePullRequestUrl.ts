import { native } from "@/lib/native";
import { githubCompareUrl, parseRemoteWebUrl } from "@/modules/git-history";
import { useEffect, useState } from "react";
import { pullRequestUpstreamCandidates } from "./pullRequestAction";

type PullRequestUrlState = {
  key: string | null;
  url: string | null;
};

function requestKey(
  repoRoot: string | null,
  localBranch: string | null,
  upstream: string | null,
  eligible: boolean,
): string | null {
  if (!eligible || !repoRoot || !localBranch || !upstream) return null;
  return [repoRoot, localBranch, upstream].join("\0");
}

export function usePullRequestUrl(
  repoRoot: string | null,
  localBranch: string | null,
  upstream: string | null,
  eligible: boolean,
): string | null {
  const key = requestKey(repoRoot, localBranch, upstream, eligible);
  const [state, setState] = useState<PullRequestUrlState>({
    key: null,
    url: null,
  });

  useEffect(() => {
    let cancelled = false;
    const candidates = pullRequestUpstreamCandidates(upstream);
    setState({ key, url: null });
    if (!key || !repoRoot || candidates.length === 0) return;

    void (async () => {
      for (const candidate of candidates) {
        const remote = await native
          .gitRemoteUrl(repoRoot, candidate.remote)
          .catch(() => null);
        if (remote !== null) {
          if (!cancelled) {
            setState({
              key,
              url: githubCompareUrl(
                parseRemoteWebUrl(remote),
                candidate.branch,
              ),
            });
          }
          return;
        }
      }
      if (!cancelled) setState({ key, url: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [key, repoRoot, upstream]);

  return state.key === key ? state.url : null;
}
