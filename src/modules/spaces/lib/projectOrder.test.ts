import { describe, expect, it } from "vitest";
import {
  orderAfterDrop,
  projectOrderAfterDrop,
} from "@/modules/spaces/lib/projectOrder";

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

describe("Space drop order", () => {
  const ids = ["personal", "work", "archive"];

  it("moves Spaces before and after targets, including the last position", () => {
    expect(orderAfterDrop(ids, "personal", "archive", "after")).toEqual([
      "work",
      "archive",
      "personal",
    ]);
    expect(orderAfterDrop(ids, "archive", "personal", "before")).toEqual([
      "archive",
      "personal",
      "work",
    ]);
    expect(orderAfterDrop(ids, "archive", "personal", "after")).toEqual([
      "personal",
      "archive",
      "work",
    ]);
    expect(ids).toEqual(["personal", "work", "archive"]);
  });

  it("preserves hidden Spaces when dropping between search results", () => {
    expect(orderAfterDrop(ids, "archive", "personal", "before")).toEqual([
      "archive",
      "personal",
      "work",
    ]);
  });

  it("ignores missing, self, and unchanged targets", () => {
    expect(orderAfterDrop(ids, "deleted", "work", "before")).toBeNull();
    expect(orderAfterDrop(ids, "work", "deleted", "before")).toBeNull();
    expect(orderAfterDrop(ids, "work", "work", "after")).toBeNull();
    expect(orderAfterDrop(ids, "personal", "work", "before")).toBeNull();
    expect(orderAfterDrop([], "personal", "work", "after")).toBeNull();
  });
});
