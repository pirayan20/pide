import { native } from "@/lib/native";
import { githubCompareUrl, parseRemoteWebUrl } from "@/modules/git-history";
import { useEffect, useState } from "react";
import { parsePullRequestUpstream } from "./pullRequestAction";

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
    const tracking = parsePullRequestUpstream(upstream);
    setState({ key, url: null });
    if (!key || !repoRoot || !tracking) return;

    void native
      .gitRemoteUrl(repoRoot, tracking.remote)
      .then((remote) => {
        if (!cancelled) {
          setState({
            key,
            url: githubCompareUrl(parseRemoteWebUrl(remote), tracking.branch),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [key, repoRoot, upstream]);

  return state.key === key ? state.url : null;
}
