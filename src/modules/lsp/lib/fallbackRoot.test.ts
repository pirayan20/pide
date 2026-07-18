import { describe, expect, it } from "vitest";
import { pickFallbackRoot } from "./fallbackRoot";

describe("pickFallbackRoot", () => {
  const file = "/Users/me/.pi/agent/extensions/notes.ts";

  it("uses the project root when it contains the file", () => {
    expect(pickFallbackRoot(file, "/Users/me/.pi/agent", false)).toBe(
      "/Users/me/.pi/agent",
    );
  });

  it("rejects a project root that does not contain the file", () => {
    expect(pickFallbackRoot(file, "/Users/me/other-project", false)).toBeNull();
  });

  it("returns null when there is no project root", () => {
    expect(pickFallbackRoot(file, null, false)).toBeNull();
  });
});
