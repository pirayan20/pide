import { native } from "@/lib/native";
import { githubCompareUrl, parseRemoteWebUrl } from "@/modules/git-history";
import { useEffect, useState } from "react";

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
    setState({ key, url: null });
    if (!key || !repoRoot || !localBranch) return;

    void native
      .gitUpstreamInfo(repoRoot, localBranch)
      .then((info) => {
        if (!cancelled) {
          setState({
            key,
            url: info
              ? githubCompareUrl(parseRemoteWebUrl(info.url), info.branch)
              : null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [key, localBranch, repoRoot]);

  return state.key === key ? state.url : null;
}
