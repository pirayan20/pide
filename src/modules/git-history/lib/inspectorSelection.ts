import type { GitCommitFileChange } from "@/lib/native";

export type InspectorSelection = {
  commitSha: string | null;
  path: string | null;
};

export function selectInspectorFilePath(
  selectedPath: string | null,
  files: readonly GitCommitFileChange[],
): string | null {
  if (selectedPath && files.some((file) => file.path === selectedPath)) {
    return selectedPath;
  }
  return files[0]?.path ?? null;
}

export function reconcileInspectorSelection(
  selection: InspectorSelection,
  commitSha: string,
  files: readonly GitCommitFileChange[],
): InspectorSelection {
  return {
    commitSha,
    path: selectInspectorFilePath(
      selection.commitSha === commitSha ? selection.path : null,
      files,
    ),
  };
}
