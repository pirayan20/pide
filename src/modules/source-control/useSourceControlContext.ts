import { useCallback } from "react";
import { native } from "@/lib/native";
import type { SidebarViewId } from "@/modules/sidebar";
import { useSourceControl } from "./useSourceControl";

type Params = {
  projectRoot: string | null;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
  }) => void;
};

export function useSourceControlContext({
  projectRoot,
  cycleSidebarView,
  openCommitHistoryTab,
}: Params) {
  const sourceControl = useSourceControl(projectRoot, true);

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!projectRoot) return;
    try {
      const repo = await native.gitResolveRepo(projectRoot);
      if (repo) {
        openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
      }
    } catch {
      return;
    }
  }, [
    openCommitHistoryTab,
    projectRoot,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
  ]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
