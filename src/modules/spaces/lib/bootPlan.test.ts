import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { planHierarchyBoot, restoredActiveTabId } from "./bootPlan";
import type { ProjectMeta, SpaceMeta } from "./store";

const space = (id: string): SpaceMeta => ({
  id,
  name: id,
  env: { kind: "local" },
  createdAt: 0,
  updatedAt: 0,
});

const project = (id: string, spaceId: string): ProjectMeta => ({
  id,
  spaceId,
  name: id,
  root: `/${id}`,
  createdAt: 0,
  updatedAt: 0,
});

describe("planHierarchyBoot", () => {
  it("starts fresh on a version mismatch", () => {
    expect(
      planHierarchyBoot({
        versionMatched: false,
        spaces: [],
        projects: [],
        activeSpaceId: null,
        activeProjectBySpace: {},
        launchRoot: null,
      }),
    ).toEqual({ kind: "fresh-empty" });
    expect(
      planHierarchyBoot({
        versionMatched: false,
        spaces: [],
        projects: [],
        activeSpaceId: null,
        activeProjectBySpace: {},
        launchRoot: "/repo",
      }),
    ).toEqual({ kind: "fresh-launch-project", root: "/repo" });
  });

  it("restores an intentionally empty version 2 hierarchy", () => {
    expect(
      planHierarchyBoot({
        versionMatched: true,
        spaces: [],
        projects: [],
        activeSpaceId: null,
        activeProjectBySpace: {},
        launchRoot: "/ignored",
      }),
    ).toEqual({
      kind: "restore",
      activeSpaceId: null,
      activeProjectId: null,
    });
  });

  it("falls invalid saved selections back to the first valid hierarchy", () => {
    expect(
      planHierarchyBoot({
        versionMatched: true,
        spaces: [space("s1"), space("s2")],
        projects: [project("p1", "s1"), project("p2", "s2")],
        activeSpaceId: "missing",
        activeProjectBySpace: { s1: "missing" },
        launchRoot: null,
      }),
    ).toEqual({
      kind: "restore",
      activeSpaceId: "s1",
      activeProjectId: "p1",
    });
  });
});

describe("restoredActiveTabId", () => {
  const tabs: Tab[] = [
    {
      id: 1,
      kind: "editor",
      projectId: "p1",
      cold: true,
      title: "a.ts",
      path: "/repo/a.ts",
      dirty: false,
      preview: false,
    },
    {
      id: 2,
      kind: "editor",
      projectId: "p1",
      cold: true,
      title: "b.ts",
      path: "/repo/b.ts",
      dirty: false,
      preview: false,
    },
  ];

  it("keeps unavailable Project tabs cold with no active tab", () => {
    expect(
      restoredActiveTabId(tabs, "p1", { p1: "unavailable" }, { p1: 1 }),
    ).toBeNull();
    expect(tabs.every((tab) => tab.cold)).toBe(true);
  });

  it("restores the remembered tab once the Project is available", () => {
    expect(
      restoredActiveTabId(tabs, "p1", { p1: "available" }, { p1: 1 }),
    ).toBe(2);
    expect(tabs.every((tab) => tab.cold)).toBe(true);
  });
});
