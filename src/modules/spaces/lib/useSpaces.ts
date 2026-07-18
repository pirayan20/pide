import { create } from "zustand";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  parseWorkspaceScopeKey,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { nextProjectAfterRemoval, nextSpaceAfterRemoval } from "./selection";
import {
  newProjectId,
  newSpaceId,
  saveActiveProjects,
  saveActiveSpaceId,
  saveProjectsList,
  saveSpacesList,
  type ProjectAvailability,
  type ProjectMeta,
  type SpaceMeta,
} from "./store";

type State = {
  spaces: SpaceMeta[];
  projects: ProjectMeta[];
  activeSpaceId: string | null;
  activeProjectBySpace: Record<string, string | null>;
  availability: Record<string, ProjectAvailability>;
  initialActiveIndex: Record<string, number | null>;
  hydrated: boolean;
  hydrate(
    spaces: SpaceMeta[],
    projects: ProjectMeta[],
    activeSpaceId: string | null,
    activeProjectBySpace: Record<string, string | null>,
    availability?: Record<string, ProjectAvailability>,
    initialActiveIndex?: Record<string, number | null>,
  ): void;
  createSpace(input: {
    id?: string;
    name: string;
    env?: WorkspaceEnv;
  }): SpaceMeta;
  createProject(input: {
    id?: string;
    spaceId: string;
    name: string;
    root: string;
  }): ProjectMeta;
  renameSpace(id: string, name: string): void;
  renameProject(id: string, name: string): void;
  setColor(id: string, color: number | undefined): void;
  reorderSpaces(orderedIds: string[]): void;
  reorderProjects(spaceId: string, orderedIds: string[]): void;
  setActiveSpace(id: string | null): void;
  setActiveProject(spaceId: string, projectId: string | null): void;
  setProjectAvailability(id: string, value: ProjectAvailability): void;
  relocateProject(id: string, root: string): void;
  setEnv(id: string, env: WorkspaceEnv): boolean;
  removeProjectMetadata(id: string): string | null;
  removeSpaceMetadata(id: string): string | null;
};

function reorderByIds<T extends { id: string }>(
  values: T[],
  orderedIds: string[],
): T[] {
  const byId = new Map(values.map((value) => [value.id, value]));
  const ordered = orderedIds.flatMap((id) => {
    const value = byId.get(id);
    return value ? [value] : [];
  });
  const seen = new Set(ordered.map((value) => value.id));
  return [...ordered, ...values.filter((value) => !seen.has(value.id))];
}

export const useSpaces = create<State>((set, get) => ({
  spaces: [],
  projects: [],
  activeSpaceId: null,
  activeProjectBySpace: {},
  availability: {},
  initialActiveIndex: {},
  hydrated: false,

  hydrate: (
    spaces,
    projects,
    activeSpaceId,
    activeProjectBySpace,
    availability = {},
    initialActiveIndex = {},
  ) => {
    set({
      spaces,
      projects,
      activeSpaceId,
      activeProjectBySpace,
      availability,
      initialActiveIndex,
      hydrated: true,
    });
  },

  createSpace: (input) => {
    const now = Date.now();
    const space: SpaceMeta = {
      id: input.id ?? newSpaceId(),
      name: input.name,
      env:
        input.env ??
        parseWorkspaceScopeKey(
          usePreferencesStore.getState().defaultWorkspaceEnv,
        ),
      createdAt: now,
      updatedAt: now,
    };
    const spaces = [...get().spaces, space];
    const activeProjectBySpace = {
      ...get().activeProjectBySpace,
      [space.id]: null,
    };
    set({ spaces, activeProjectBySpace });
    void saveSpacesList(spaces);
    void saveActiveProjects(activeProjectBySpace);
    return space;
  },

  createProject: (input) => {
    const now = Date.now();
    const project: ProjectMeta = {
      id: input.id ?? newProjectId(),
      spaceId: input.spaceId,
      name: input.name,
      root: input.root,
      createdAt: now,
      updatedAt: now,
    };
    const projects = [...get().projects, project];
    const activeProjectBySpace = {
      ...get().activeProjectBySpace,
      [project.spaceId]: project.id,
    };
    const availability = {
      ...get().availability,
      [project.id]: "available" as const,
    };
    set({ projects, activeProjectBySpace, availability });
    void saveProjectsList(projects);
    void saveActiveProjects(activeProjectBySpace);
    return project;
  },

  renameSpace: (id, name) => {
    const spaces = get().spaces.map((space) =>
      space.id === id ? { ...space, name, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  renameProject: (id, name) => {
    const projects = get().projects.map((project) =>
      project.id === id ? { ...project, name, updatedAt: Date.now() } : project,
    );
    set({ projects });
    void saveProjectsList(projects);
  },

  setColor: (id, color) => {
    const spaces = get().spaces.map((space) =>
      space.id === id ? { ...space, color, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  reorderSpaces: (orderedIds) => {
    const spaces = reorderByIds(get().spaces, orderedIds);
    set({ spaces });
    void saveSpacesList(spaces);
  },

  reorderProjects: (spaceId, orderedIds) => {
    const current = get().projects;
    const siblings = current.filter((project) => project.spaceId === spaceId);
    const reordered = reorderByIds(siblings, orderedIds);
    let index = 0;
    const projects = current.map((project) =>
      project.spaceId === spaceId ? reordered[index++] : project,
    );
    set({ projects });
    void saveProjectsList(projects);
  },

  setActiveSpace: (id) => {
    if (get().activeSpaceId === id) return;
    set({ activeSpaceId: id });
    void saveActiveSpaceId(id);
  },

  setActiveProject: (spaceId, projectId) => {
    const valid =
      projectId === null ||
      get().projects.some(
        (project) => project.id === projectId && project.spaceId === spaceId,
      );
    if (!valid || get().activeProjectBySpace[spaceId] === projectId) return;
    const activeProjectBySpace = {
      ...get().activeProjectBySpace,
      [spaceId]: projectId,
    };
    set({ activeProjectBySpace });
    void saveActiveProjects(activeProjectBySpace);
  },

  setProjectAvailability: (id, value) => {
    set({ availability: { ...get().availability, [id]: value } });
  },

  relocateProject: (id, root) => {
    const projects = get().projects.map((project) =>
      project.id === id
        ? { ...project, root, updatedAt: Date.now() }
        : project,
    );
    set({ projects });
    void saveProjectsList(projects);
  },

  setEnv: (id, env) => {
    if (get().projects.some((project) => project.spaceId === id)) return false;
    const spaces = get().spaces.map((space) =>
      space.id === id ? { ...space, env, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
    return true;
  },

  removeProjectMetadata: (id) => {
    const current = get();
    const removed = current.projects.find((project) => project.id === id);
    if (!removed) return current.activeSpaceId
      ? current.activeProjectBySpace[current.activeSpaceId] ?? null
      : null;
    const nextProject = nextProjectAfterRemoval(
      current.projects,
      id,
      removed.spaceId,
    );
    const projects = current.projects.filter((project) => project.id !== id);
    const selected = current.activeProjectBySpace[removed.spaceId];
    const activeProjectBySpace = {
      ...current.activeProjectBySpace,
      [removed.spaceId]: selected === id ? nextProject : selected ?? nextProject,
    };
    const { [id]: _availability, ...availability } = current.availability;
    const { [id]: _initialIndex, ...initialActiveIndex } =
      current.initialActiveIndex;
    set({
      projects,
      activeProjectBySpace,
      availability,
      initialActiveIndex,
    });
    void saveProjectsList(projects);
    void saveActiveProjects(activeProjectBySpace);
    return activeProjectBySpace[removed.spaceId] ?? null;
  },

  removeSpaceMetadata: (id) => {
    const current = get();
    const nextSpace = nextSpaceAfterRemoval(
      current.spaces.map((space) => space.id),
      id,
    );
    const removedProjectIds = new Set(
      current.projects
        .filter((project) => project.spaceId === id)
        .map((project) => project.id),
    );
    const spaces = current.spaces.filter((space) => space.id !== id);
    const projects = current.projects.filter(
      (project) => !removedProjectIds.has(project.id),
    );
    const { [id]: _activeProject, ...activeProjectBySpace } =
      current.activeProjectBySpace;
    const availability = Object.fromEntries(
      Object.entries(current.availability).filter(
        ([projectId]) => !removedProjectIds.has(projectId),
      ),
    );
    const initialActiveIndex = Object.fromEntries(
      Object.entries(current.initialActiveIndex).filter(
        ([projectId]) => !removedProjectIds.has(projectId),
      ),
    );
    const activeSpaceId =
      current.activeSpaceId === id ? nextSpace : current.activeSpaceId;
    set({
      spaces,
      projects,
      activeSpaceId,
      activeProjectBySpace,
      availability,
      initialActiveIndex,
    });
    void saveSpacesList(spaces);
    void saveProjectsList(projects);
    void saveActiveSpaceId(activeSpaceId);
    void saveActiveProjects(activeProjectBySpace);
    return activeSpaceId;
  },
}));
