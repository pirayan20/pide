import { beforeEach, describe, expect, it, vi } from "vitest";

const values = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async entries() {
      return [...values.entries()];
    }
    async set(key: string, value: unknown) {
      values.set(key, value);
    }
    async delete(key: string) {
      values.delete(key);
    }
    async clear() {
      values.clear();
    }
  },
}));

import {
  loadAll,
  resetHierarchy,
  saveActiveProjects,
  saveActiveSpaceId,
  saveProjectsList,
  saveSpacesList,
  SPACE_SCHEMA_VERSION,
} from "./store";

beforeEach(() => values.clear());

describe("version 2 hierarchy store", () => {
  it("reports a version mismatch without restoring version 1 data", async () => {
    values.set("spaces", [{ id: "legacy" }]);

    expect(await loadAll()).toMatchObject({
      versionMatched: false,
      spaces: [],
      projects: [],
      activeSpaceId: null,
    });
  });

  it("preserves an intentionally empty version 2 hierarchy", async () => {
    await resetHierarchy();
    await saveSpacesList([]);
    await saveProjectsList([]);
    await saveActiveSpaceId(null);
    await saveActiveProjects({});

    expect(await loadAll()).toMatchObject({
      versionMatched: true,
      spaces: [],
      projects: [],
      activeSpaceId: null,
      activeProjectBySpace: {},
    });
  });

  it("writes the schema version immediately after reset", async () => {
    values.set("legacy", true);
    await resetHierarchy();

    expect(values).toEqual(new Map([["schemaVersion", SPACE_SCHEMA_VERSION]]));
  });
});
