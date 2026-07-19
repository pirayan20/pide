import { LazyStore } from "@tauri-apps/plugin-store";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SerializedTab } from "./serialize";

export const SPACE_SCHEMA_VERSION = 2;
export const DEFAULT_SPACE_ID = "default";

export type SpaceMeta = {
  id: string;
  name: string;
  env: WorkspaceEnv;
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMeta = {
  id: string;
  spaceId: string;
  name: string;
  root: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectAvailability = "available" | "unavailable";

export type ProjectState = {
  tabs: SerializedTab[];
  activeTabIndex: number | null;
};

export type LoadedHierarchy = {
  versionMatched: boolean;
  spaces: SpaceMeta[];
  projects: ProjectMeta[];
  activeSpaceId: string | null;
  activeProjectBySpace: Record<string, string | null>;
  states: Map<string, ProjectState>;
};

const STORE_PATH = "pide-spaces.json";
const KEY_SCHEMA_VERSION = "schemaVersion";
const KEY_SPACES = "spaces";
const KEY_PROJECTS = "projects";
const KEY_ACTIVE_SPACE = "activeSpaceId";
const KEY_ACTIVE_PROJECTS = "activeProjectBySpace";
const STATE_PREFIX = "project-state:";
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export async function loadAll(): Promise<LoadedHierarchy> {
  const entries = await store.entries();
  const values = new Map(entries);
  const versionMatched = values.get(KEY_SCHEMA_VERSION) === SPACE_SCHEMA_VERSION;
  if (!versionMatched) {
    return {
      versionMatched: false,
      spaces: [],
      projects: [],
      activeSpaceId: null,
      activeProjectBySpace: {},
      states: new Map(),
    };
  }

  const states = new Map<string, ProjectState>();
  for (const [key, value] of entries) {
    if (key.startsWith(STATE_PREFIX)) {
      states.set(key.slice(STATE_PREFIX.length), value as ProjectState);
    }
  }

  return {
    versionMatched: true,
    spaces: (values.get(KEY_SPACES) as SpaceMeta[] | undefined) ?? [],
    projects: (values.get(KEY_PROJECTS) as ProjectMeta[] | undefined) ?? [],
    activeSpaceId:
      (values.get(KEY_ACTIVE_SPACE) as string | null | undefined) ?? null,
    activeProjectBySpace:
      (values.get(KEY_ACTIVE_PROJECTS) as
        | Record<string, string | null>
        | undefined) ?? {},
    states,
  };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  await store.set(KEY_SPACES, spaces);
}

export async function saveProjectsList(projects: ProjectMeta[]): Promise<void> {
  await store.set(KEY_PROJECTS, projects);
}

export async function saveActiveSpaceId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE_SPACE, id);
}

export async function saveActiveProjects(
  value: Record<string, string | null>,
): Promise<void> {
  await store.set(KEY_ACTIVE_PROJECTS, value);
}

export async function saveProjectState(
  id: string,
  state: ProjectState,
): Promise<void> {
  await store.set(stateKey(id), state);
}

export async function deleteProjectData(id: string): Promise<void> {
  await store.delete(stateKey(id));
}

export async function resetHierarchy(): Promise<void> {
  await store.clear();
  await store.set(KEY_SCHEMA_VERSION, SPACE_SCHEMA_VERSION);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSpaceId(): string {
  return newId("sp");
}

export function newProjectId(): string {
  return newId("pr");
}
