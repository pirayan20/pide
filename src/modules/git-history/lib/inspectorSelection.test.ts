import { describe, expect, it } from "vitest";
import type { GitCommitFileChange } from "@/lib/native";
import {
  reconcileInspectorSelection,
  selectInspectorFilePath,
} from "@/modules/git-history/lib/inspectorSelection";

const files: GitCommitFileChange[] = [
  {
    path: "src/one.ts",
    originalPath: null,
    status: "M",
    statusLabel: "Modified",
    added: 1,
    removed: 0,
    isBinary: false,
  },
  {
    path: "src/two.ts",
    originalPath: null,
    status: "A",
    statusLabel: "Added",
    added: 1,
    removed: 0,
    isBinary: false,
  },
];

describe("selectInspectorFilePath", () => {
  it("preserves the selected path when it remains in the commit", () => {
    expect(selectInspectorFilePath("src/two.ts", files)).toBe("src/two.ts");
  });

  it("uses the first file when the selected path is absent", () => {
    expect(selectInspectorFilePath("src/missing.ts", files)).toBe("src/one.ts");
  });

  it("returns null when the commit has no changed files", () => {
    expect(selectInspectorFilePath("src/one.ts", [])).toBeNull();
  });

  it("uses the current commit's first file immediately", () => {
    expect(
      reconcileInspectorSelection(
        { commitSha: "old", path: "src/two.ts" },
        "current",
        files,
      ),
    ).toEqual({ commitSha: "current", path: "src/one.ts" });
  });
});
