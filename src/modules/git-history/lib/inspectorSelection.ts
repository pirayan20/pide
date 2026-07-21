import type { GitCommitFileChange } from "@/lib/native";

export function selectInspectorFilePath(
  selectedPath: string | null,
  files: readonly GitCommitFileChange[],
): string | null {
  if (selectedPath && files.some((file) => file.path === selectedPath)) {
    return selectedPath;
  }
  return files[0]?.path ?? null;
}
