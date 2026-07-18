import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
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

/**
 * Reads a text file via `fs_read_file` and tracks loading/error/binary/
 * too-large state. Shared by every render-pane (markdown today; mermaid/csv/
 * notebook stubs use it too). Re-reads whenever `path` changes.
 *
 * No file-watching here yet — refresh-on-external-change lands in Phase 5.
 */
export function useFileText(path: string): FileTextStatus {
  const [status, setStatus] = useState<FileTextStatus>({ kind: "loading" });

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
  }, [path]);

  return status;
}
