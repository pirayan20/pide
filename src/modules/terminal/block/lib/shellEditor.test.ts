import { describe, expect, it } from "vitest";
import { commandOptions } from "./shellEditor";

describe("shell command completion", () => {
  it("uses discovered shell commands matching the prefix", () => {
    expect(commandOptions("git", () => ["git", "gitalias", "cargo"])).toEqual([
      { label: "git", type: "function" },
      { label: "gitalias", type: "function" },
    ]);
  });

  it("falls back to built-in commands when discovery is empty", () => {
    expect(commandOptions("ech", () => [])).toContainEqual({
      label: "echo",
      type: "function",
    });
  });
});
