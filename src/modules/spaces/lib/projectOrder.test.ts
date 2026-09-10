import { describe, expect, it } from "vitest";
import { projectOrderAfterDrop } from "@/modules/spaces/lib/projectOrder";

const projects = [
  { id: "a", spaceId: "one" },
  { id: "foreign", spaceId: "two" },
  { id: "b", spaceId: "one" },
  { id: "c", spaceId: "one" },
];

describe("project drop order", () => {
  it("moves to either end or between siblings", () => {
    expect(projectOrderAfterDrop(projects, "one", "a", "c", "after")).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(projectOrderAfterDrop(projects, "one", "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(projectOrderAfterDrop(projects, "one", "c", "a", "after")).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
  it("rejects cross-space, missing, self, and unchanged drops", () => {
    expect(
      projectOrderAfterDrop(projects, "two", "a", "foreign", "after"),
    ).toBeNull();
    expect(
      projectOrderAfterDrop(projects, "one", "a", "foreign", "before"),
    ).toBeNull();
    expect(
      projectOrderAfterDrop(projects, "one", "missing", "b", "after"),
    ).toBeNull();
    expect(
      projectOrderAfterDrop(projects, "one", "a", "a", "after"),
    ).toBeNull();
    expect(
      projectOrderAfterDrop(projects, "one", "a", "b", "before"),
    ).toBeNull();
  });
});
