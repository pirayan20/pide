import { describe, expect, it } from "vitest";
import { pathMatches } from "./useFileText";

describe("pathMatches", () => {
  it("matches identical POSIX paths", () => {
    expect(pathMatches("/a/b/c.md", "/a/b/c.md")).toBe(true);
  });

  it("matches when the event path uses Windows separators", () => {
    expect(pathMatches("C:\\a\\b\\c.md", "C:/a/b/c.md")).toBe(true);
  });

  it("does not match a different file", () => {
    expect(pathMatches("/a/b/other.md", "/a/b/c.md")).toBe(false);
  });
});
