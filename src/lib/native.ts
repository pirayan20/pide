import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitEditorBaselinesResult = {
  repoRoot: string | null;
  repoPath: string | null;
  tracked: boolean;
  headContent: string;
  indexContent: string;
  isBinary: boolean;
  oversized: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitBranchEntry = {
  name: string;
  kind: "local" | "worktree";
  worktreePath: string | null;
  isHead: boolean;
  isDetached: boolean;
};

export type GitBranchListResult = {
  branches: GitBranchEntry[];
};

export type GitMergeResult = {
  merged: boolean;
  hadConflicts: boolean;
  conflictedFiles: string[];
  message: string;
};

export type GitStashResult = {
  stashed: boolean;
  sha: string | null;
  message: string;
};

export type GitStashEntry = {
  index: number;
  sha: string;
  message: string;
  branch: string | null;
};

export type GitStashApplyResult = {
  applied: boolean;
  hadConflicts: boolean;
  conflictedFiles: string[];
};

const workspace = () => currentWorkspaceEnv();

export type GitChangedEvent = { repoRoot: string };
type GitChangedListener = (event: GitChangedEvent) => void;
const gitChangedListeners = new Set<GitChangedListener>();

export function onGitChanged(listener: GitChangedListener): () => void {
  gitChangedListeners.add(listener);
  return () => gitChangedListeners.delete(listener);
}

function notifyGitChanged(repoRoot: string): void {
  for (const listener of gitChangedListeners) listener({ repoRoot });
}

async function invokeGitMutation<T>(
  command: string,
  repoRoot: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await invoke<T>(command, args);
  notifyGitChanged(repoRoot);
  return result;
}

export const native = {
  workspaceCurrentDir: () => invoke<string>("workspace_current_dir"),
  workspaceAuthorize: (path: string, env = currentWorkspaceEnv()) =>
    invoke<string>("workspace_authorize", { path, workspace: env }),
  canonicalize: (path: string, env = currentWorkspaceEnv()) =>
    invoke<string>("fs_canonicalize", { path, workspace: env }),
  fileStat: (path: string, env = currentWorkspaceEnv()) =>
    invoke<{
      size: number;
      mtime: number;
      kind: "file" | "dir" | "symlink";
    }>("fs_stat", { path, workspace: env }),
  gitResolveRepo: (cwd: string, env = currentWorkspaceEnv()) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", { cwd, workspace: env }),
  gitPanelSnapshot: (cwd: string) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
      workspace: workspace(),
    }),
  gitStatus: (repoRoot: string) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
      workspace: workspace(),
    }),
  gitDiffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
      workspace: workspace(),
    }),
  gitEditorBaselines: (path: string) =>
    invoke<GitEditorBaselinesResult>("git_editor_baselines", {
      path,
      workspace: workspace(),
    }),
  gitStage: (repoRoot: string, paths: string[]) =>
    invokeGitMutation<void>("git_stage", repoRoot, {
      repoRoot,
      paths,
      workspace: workspace(),
    }),
  gitUnstage: (repoRoot: string, paths: string[]) =>
    invokeGitMutation<void>("git_unstage", repoRoot, {
      repoRoot,
      paths,
      workspace: workspace(),
    }),
  gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) =>
    invokeGitMutation<void>("git_discard", repoRoot, {
      repoRoot,
      entries,
      workspace: workspace(),
    }),
  gitCommit: (repoRoot: string, message: string) =>
    invokeGitMutation<GitCommitResult>("git_commit", repoRoot, {
      repoRoot,
      message,
      workspace: workspace(),
    }),
  gitFetch: (repoRoot: string) =>
    invoke<void>("git_fetch", { repoRoot, workspace: workspace() }),
  gitPullFfOnly: (repoRoot: string) =>
    invokeGitMutation<void>("git_pull_ff_only", repoRoot, {
      repoRoot,
      workspace: workspace(),
    }),
  gitPush: (repoRoot: string) =>
    invoke<GitPushResult>("git_push", { repoRoot, workspace: workspace() }),
  gitLog: (
    repoRoot: string,
    options?: { limit?: number; beforeSha?: string },
  ) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      beforeSha: options?.beforeSha ?? null,
      workspace: workspace(),
    }),
  gitCommitFiles: (repoRoot: string, sha: string) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
      workspace: workspace(),
    }),
  gitCommitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
      workspace: workspace(),
    }),
  gitRemoteUrl: (repoRoot: string, name?: string) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
      workspace: workspace(),
    }),
  gitListBranches: (repoRoot: string) =>
    invoke<GitBranchListResult>("git_list_branches", {
      repoRoot,
      workspace: workspace(),
    }),
  gitCheckoutBranch: (repoRoot: string, branch: string) =>
    invokeGitMutation<void>("git_checkout_branch", repoRoot, {
      repoRoot,
      branch,
      workspace: workspace(),
    }),
  gitCreateBranch: (
    repoRoot: string,
    name: string,
    checkout: boolean,
    startPoint: string | null = null,
  ) =>
    invokeGitMutation<void>("git_create_branch", repoRoot, {
      repoRoot,
      name,
      checkout,
      startPoint,
      workspace: workspace(),
    }),
  gitRenameBranch: (
    repoRoot: string,
    oldName: string | null,
    newName: string,
  ) =>
    invokeGitMutation<void>("git_rename_branch", repoRoot, {
      repoRoot,
      oldName,
      newName,
      workspace: workspace(),
    }),
  gitDeleteBranch: (repoRoot: string, name: string, force: boolean) =>
    invokeGitMutation<void>("git_delete_branch", repoRoot, {
      repoRoot,
      name,
      force,
      workspace: workspace(),
    }),
  gitMergeBranch: (repoRoot: string, branch: string) =>
    invokeGitMutation<GitMergeResult>("git_merge_branch", repoRoot, {
      repoRoot,
      branch,
      workspace: workspace(),
    }),
  gitStashSave: (
    repoRoot: string,
    message: string | null,
    includeUntracked: boolean,
  ) =>
    invokeGitMutation<GitStashResult>("git_stash_save", repoRoot, {
      repoRoot,
      message,
      includeUntracked,
      workspace: workspace(),
    }),
  gitStashList: (repoRoot: string) =>
    invoke<GitStashEntry[]>("git_stash_list", {
      repoRoot,
      workspace: workspace(),
    }),
  gitStashApply: (repoRoot: string, sha: string, pop: boolean) =>
    invokeGitMutation<GitStashApplyResult>("git_stash_apply", repoRoot, {
      repoRoot,
      sha,
      pop,
      workspace: workspace(),
    }),
  gitStashDrop: (repoRoot: string, sha: string) =>
    invokeGitMutation<void>("git_stash_drop", repoRoot, {
      repoRoot,
      sha,
      workspace: workspace(),
    }),
};
