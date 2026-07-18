import { describe, expect, it } from "vitest";
import { pathsOverlap, rebasePath } from "./projectPaths";

describe("pathsOverlap", () => {
  it("rejects equal and nested Unix roots by complete path segment", () => {
    expect(pathsOverlap("/repo", "/repo", false)).toBe(true);
    expect(pathsOverlap("/repo", "/repo/packages/app", false)).toBe(true);
    expect(pathsOverlap("/repo-one", "/repo-two", false)).toBe(false);
  });

  it("normalizes Windows separators and compares roots case-insensitively", () => {
    expect(pathsOverlap("C:\\Repo", "c:/repo/app", true)).toBe(true);
    expect(pathsOverlap("C:\\Repo", "C:\\Repository", true)).toBe(false);
  });

  it("treats the Unix filesystem root as an ancestor", () => {
    expect(pathsOverlap("/", "/repo", false)).toBe(true);
  });

  it("treats a Windows drive root as an ancestor case-insensitively", () => {
    expect(pathsOverlap("C:/", "c:\\repo\\", true)).toBe(true);
  });

  it("keeps WSL paths case-sensitive", () => {
    expect(pathsOverlap("/home/me/Repo", "/home/me/repo", false)).toBe(false);
  });

  it("preserves UNC roots and compares them by segment", () => {
    expect(
      pathsOverlap("\\\\server\\share", "//SERVER//share///repo", true),
    ).toBe(true);
    expect(pathsOverlap("//server/share", "//server/shared", true)).toBe(
      false,
    );
  });
});

describe("rebasePath", () => {
  it("rebases descendants of a moved Unix root", () => {
    expect(
      rebasePath("/old/repo/src/a.ts", "/old/repo", "/new/repo", false),
    ).toBe("/new/repo/src/a.ts");
  });

  it("rebases Windows paths case-insensitively with normalized separators", () => {
    expect(
      rebasePath("c:\\repo\\src\\a.ts", "C:\\Repo", "D:\\Work\\Repo", true),
    ).toBe("D:/Work/Repo/src/a.ts");
  });

  it("rebases an exact Unix root", () => {
    expect(rebasePath("/old/repo", "/old/repo", "/new/repo", false)).toBe(
      "/new/repo",
    );
  });

  it("rebases an exact Windows root case-insensitively", () => {
    expect(
      rebasePath("c:\\repo\\", "C:/Repo", "D:\\Work\\Repo\\", true),
    ).toBe("D:/Work/Repo");
  });

  it("rebases UNC paths with exactly two leading slashes", () => {
    expect(
      rebasePath(
        "\\\\server\\share\\old\\\\file",
        "//server/share/old",
        "\\\\server\\share\\\\new\\",
        true,
      ),
    ).toBe("//server/share/new/file");
  });

  it("leaves paths outside the old root unchanged", () => {
    expect(rebasePath("/tmp/a", "/old/repo", "/new/repo", false)).toBe(
      "/tmp/a",
    );
  });
});
