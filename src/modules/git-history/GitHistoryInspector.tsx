import { Button } from "@/components/ui/button";
import { GitDiffPane } from "@/modules/editor";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { cn } from "@/lib/utils";
import type { GitCommitFileChange, GitLogEntry } from "@/lib/native";
import { Copy01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import {
  commitWebUrl,
  hostLabel,
  type RemoteWebInfo,
} from "./lib/remoteWebUrl";

const COMMIT_ROW_HEIGHT = 48;
const NEAR_BOTTOM_PX = 240;

export type FilesState =
  | { state: "loading" }
  | { state: "loaded"; files: GitCommitFileChange[] }
  | { state: "error"; error: string };

type Props = {
  repoRoot: string;
  commits: GitLogEntry[];
  selectedSha: string;
  filesState: FilesState;
  remoteWeb: RemoteWebInfo | null;
  onBack: () => void;
  onSelectCommit: (sha: string) => void;
  onRetryFiles: () => void;
  onOpenFileTab: (commit: GitLogEntry, file: GitCommitFileChange) => void;
  isLoadingMore: boolean;
  endReached: boolean;
  onLoadMore?: () => void;
};

function absoluteTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactDate(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function statusTone(code: string): string {
  switch (code.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-300";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    default:
      return "text-muted-foreground";
  }
}

export function GitHistoryInspector({
  repoRoot,
  commits,
  selectedSha,
  filesState,
  remoteWeb,
  onBack,
  onSelectCommit,
  onRetryFiles,
  onOpenFileTab,
  isLoadingMore,
  endReached,
  onLoadMore,
}: Props) {
  const commit = commits.find((entry) => entry.sha === selectedSha) ?? null;
  const files = filesState.state === "loaded" ? filesState.files : [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => COMMIT_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => commits[index]?.sha ?? index,
  });

  useEffect(() => {
    setSelectedPath(files[0]?.path ?? null);
  }, [files]);

  useEffect(() => {
    if (!commit) onBack();
  }, [commit, onBack]);

  const webUrl =
    commit && remoteWeb ? commitWebUrl(remoteWeb, commit.sha) : null;
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  const handleListScroll = () => {
    const element = listRef.current;
    if (!element || !onLoadMore || isLoadingMore || endReached) return;
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < NEAR_BOTTOM_PX) onLoadMore();
  };

  if (!commit) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center border-b border-border/50 px-2">
        <Button
          size="xs"
          variant="ghost"
          className="cursor-pointer text-[11px]"
          onClick={onBack}
        >
          Back to Commit Graph
        </Button>
      </header>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(220px,28%)_minmax(0,1fr)]">
        <aside className="min-h-0 min-w-0 overflow-hidden border-b border-border/50 lg:border-b-0 lg:border-r">
          <div className="h-7 border-b border-border/40 px-3 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Commits
          </div>
          <div
            ref={listRef}
            onScroll={handleListScroll}
            className="min-h-0 h-[30vh] overflow-y-auto lg:h-[calc(100%-1.75rem)]"
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const entry = commits[row.index];
                if (!entry) return null;
                const selected = entry.sha === commit.sha;
                return (
                  <button
                    key={row.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectCommit(entry.sha)}
                    className={cn(
                      "absolute left-0 flex w-full cursor-pointer flex-col justify-center gap-0.5 border-l-2 border-transparent px-3 text-left transition-colors",
                      selected
                        ? "border-l-primary bg-accent/50 font-semibold text-foreground"
                        : "hover:bg-accent/30",
                    )}
                    style={{
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <span className="truncate text-[11.5px] leading-tight">
                      {entry.subject || "(no subject)"}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {entry.shortSha} · {entry.author || "Unknown"} ·{" "}
                      {compactDate(entry.timestampSecs)}
                    </span>
                  </button>
                );
              })}
            </div>
            {isLoadingMore ? (
              <div className="px-3 py-2 text-[10.5px] text-muted-foreground">
                Loading more…
              </div>
            ) : endReached ? (
              <div className="px-3 py-2 text-[10.5px] text-muted-foreground/65">
                End of history
              </div>
            ) : null}
          </div>
        </aside>
        <main className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <section className="min-w-0 overflow-hidden border-b border-border/50 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {commit.shortSha}
              </span>
              <h2 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">
                {commit.subject || "(no subject)"}
              </h2>
            </div>
            {commit.body ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
                {commit.body}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
              <span>{commit.author || "Unknown"}</span>
              {commit.authorEmail ? <span>{commit.authorEmail}</span> : null}
              <span>{absoluteTime(commit.timestampSecs)}</span>
              <span className="font-mono">{commit.sha}</span>
              <span>{commit.filesChanged} files</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                +{commit.insertions}
              </span>
              <span className="font-mono text-rose-600 dark:text-rose-400">
                −{commit.deletions}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                className="h-6 cursor-pointer gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  void navigator.clipboard.writeText(commit.sha).catch(() => {})
                }
              >
                <HugeiconsIcon icon={Copy01Icon} size={11} strokeWidth={1.9} />
                Copy SHA
              </Button>
              {webUrl && remoteWeb ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-6 cursor-pointer gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => void openUrl(webUrl).catch(console.error)}
                >
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    size={11}
                    strokeWidth={1.9}
                  />
                  {hostLabel(remoteWeb)}
                </Button>
              ) : null}
            </div>
          </section>
          <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)]">
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border/50 xl:border-b-0 xl:border-r">
              <div className="flex h-8 shrink-0 items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>Changed files</span>
                {filesState.state === "loaded" ? (
                  <span className="rounded bg-muted px-1 py-px text-[9.5px] tabular-nums normal-case tracking-normal">
                    {files.length}
                  </span>
                ) : null}
              </div>
              {filesState.state === "loading" ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
                  Loading files…
                </div>
              ) : null}
              {filesState.state === "error" ? (
                <div className="flex items-center justify-between gap-2 px-3 py-3 text-[11px] text-destructive">
                  <span className="min-w-0 truncate">{filesState.error}</span>
                  <Button size="xs" variant="ghost" onClick={onRetryFiles}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {filesState.state === "loaded" && files.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-muted-foreground">
                  No file changes.
                </div>
              ) : null}
              {filesState.state === "loaded" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {files.map((file) => {
                    const selected = file.path === selectedFile?.path;
                    const icon = fileIconUrl(basename(file.path));
                    return (
                      <button
                        key={file.path}
                        type="button"
                        aria-pressed={selected}
                        title={file.path}
                        onClick={() => setSelectedPath(file.path)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 border-l-2 border-transparent px-2 py-1.5 text-left text-[11px] transition-colors",
                          selected
                            ? "border-l-primary bg-accent/50 font-semibold"
                            : "hover:bg-accent/30",
                        )}
                      >
                        {icon ? (
                          <img
                            src={icon}
                            alt=""
                            className="size-3.5 shrink-0"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {basename(file.path)}
                          </span>
                          {dirname(file.path) ? (
                            <span className="block truncate text-[9.5px] font-normal text-muted-foreground">
                              {dirname(file.path)}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[10px]",
                            statusTone(file.status),
                          )}
                        >
                          {file.status.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
            <section className="min-h-0 min-w-0 overflow-hidden p-2">
              {selectedFile ? (
                <div className="flex h-full min-h-0 flex-col gap-2">
                  <div className="flex shrink-0 items-center justify-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-6 cursor-pointer text-[11px]"
                      onClick={() => onOpenFileTab(commit, selectedFile)}
                    >
                      Open in tab
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <GitDiffPane
                      key={`${commit.sha}:${selectedFile.path}`}
                      active
                      chipLabel="Commit"
                      source={{
                        kind: "commit",
                        repoRoot,
                        sha: commit.sha,
                        path: selectedFile.path,
                        originalPath: selectedFile.originalPath,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                  Select a changed file to inspect its diff.
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
