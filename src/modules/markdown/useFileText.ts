import { listenFsChanged } from "@/modules/explorer/lib/watch";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type FileTextStatus =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

/** Normalizes path separators so Windows/POSIX paths compare equal. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Whether an event path (possibly Windows-style) names the same file as `path`. */
export function pathMatches(eventPath: string, path: string): boolean {
  return normalizePath(eventPath) === normalizePath(path);
}

/**
 * Reads a text file via `fs_read_file` and tracks loading/error/binary/
 * too-large state. Shared by every render-pane (markdown, mermaid, csv,
 * notebook). Re-reads whenever `path` changes, and re-reads on external
 * writes to `path` (mirrors `useEditorFileSync`'s `fs:file-written` /
 * `listenFsChanged` handling, but self-contained — no ref plumbing needed).
 */
export function useFileText(path: string): FileTextStatus {
  const [status, setStatus] = useState<FileTextStatus>({ kind: "loading" });
  const [reloadNonce, setReloadNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce is a manual re-read trigger
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadNonce]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenWrittenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          if (pathMatches(event.payload.path, path)) {
            setReloadNonce((n) => n + 1);
          }
        },
      );

    let alive = true;
    let unlistenChanged: (() => void) | undefined;
    void listenFsChanged((paths) => {
      if (paths.some((p) => pathMatches(p, path))) {
        setReloadNonce((n) => n + 1);
      }
    }).then((un) => {
      if (alive) unlistenChanged = un;
      else un();
    });

    return () => {
      alive = false;
      void unlistenWrittenPromise.then((un) => un());
      unlistenChanged?.();
    };
  }, [path]);

  return status;
}
