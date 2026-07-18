import { describe, expect, it } from "vitest";
import { nextProjectAfterRemoval, nextSpaceAfterRemoval } from "./selection";

const projects = [
  { id: "p1", spaceId: "s1" },
  { id: "p2", spaceId: "s1" },
  { id: "p3", spaceId: "s1" },
  { id: "p4", spaceId: "s2" },
];

describe("nextProjectAfterRemoval", () => {
  it("prefers the next sibling, then the previous sibling", () => {
    expect(nextProjectAfterRemoval(projects, "p2", "s1")).toBe("p3");
    expect(nextProjectAfterRemoval(projects, "p3", "s1")).toBe("p2");
  });

  it("returns null when the Space becomes empty", () => {
    expect(nextProjectAfterRemoval(projects, "p4", "s2")).toBeNull();
  });
});

describe("nextSpaceAfterRemoval", () => {
  it("prefers the next Space and permits zero Spaces", () => {
    expect(nextSpaceAfterRemoval(["s1", "s2", "s3"], "s2")).toBe("s3");
    expect(nextSpaceAfterRemoval(["s1"], "s1")).toBeNull();
  });
});
