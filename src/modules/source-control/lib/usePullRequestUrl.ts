import { native } from "@/lib/native";
import {
  githubCompareUrl,
  parseRemoteWebUrl,
} from "@/modules/git-history";
import { useEffect, useState } from "react";

export function usePullRequestUrl(
  repoRoot: string | null,
  branch: string | null,
  eligible: boolean,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!eligible || !repoRoot || !branch) return;

    void native
      .gitRemoteUrl(repoRoot)
      .then((remote) => {
        if (!cancelled) {
          setUrl(githubCompareUrl(parseRemoteWebUrl(remote), branch));
        }
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [branch, eligible, repoRoot]);

  return url;
}
