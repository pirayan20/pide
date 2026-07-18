import { useEffect, useRef } from "react";
import { native } from "@/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { activeSpaceEnv } from "./activeSpace";
import { planHierarchyBoot, restoredActiveTabId } from "./bootPlan";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import {
  DEFAULT_SPACE_ID,
  loadAll,
  newProjectId,
  resetHierarchy,
  saveActiveProjects,
  saveActiveSpaceId,
  saveProjectsList,
  saveSpacesList,
  type ProjectAvailability,
  type ProjectMeta,
  type SpaceMeta,
} from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number | null) => void;
  markBooted: () => void;
  setActiveProjectForNewTabs: (id: string | null) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function terminalCwds(tab: Tab): string[] {
  if (tab.kind !== "terminal") return [];
  const result: string[] = [];
  const visit = (node: PaneNode) => {
    if (isLeaf(node)) {
      if (node.cwd) result.push(node.cwd);
      return;
    }
    node.children.forEach(visit);
  };
  visit(tab.paneTree);
  return result;
}

export function useSpacesBoot({
  ready,
  launchCwd,
  allocId,
  replaceTabs,
  markBooted,
  setActiveProjectForNewTabs,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const loaded = await loadAll();
        const bootPlan = planHierarchyBoot({
          versionMatched: loaded.versionMatched,
          spaces: loaded.spaces,
          projects: loaded.projects,
          activeSpaceId: loaded.activeSpaceId,
          activeProjectBySpace: loaded.activeProjectBySpace,
          launchRoot: launchCwd,
        });

        if (bootPlan.kind !== "restore") {
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          await resetHierarchy();
          const now = Date.now();
          const space: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            env: parseWorkspaceScopeKey(
              usePreferencesStore.getState().defaultWorkspaceEnv,
            ),
            createdAt: now,
            updatedAt: now,
          };
          const projects: ProjectMeta[] = [];
          const availability: Record<string, ProjectAvailability> = {};
          const activeProjectBySpace: Record<string, string | null> = {
            [space.id]: null,
          };
          const tabs: Tab[] = [];

          if (bootPlan.kind === "fresh-launch-project") {
            try {
              const root = await native.canonicalize(bootPlan.root, space.env);
              const stat = await native.fileStat(root, space.env);
              if (stat.kind !== "dir") throw new Error("not a directory");
              await native.workspaceAuthorize(root, space.env);
              const project: ProjectMeta = {
                id: newProjectId(),
                spaceId: space.id,
                name: basename(root),
                root,
                createdAt: now,
                updatedAt: now,
              };
              projects.push(project);
              availability[project.id] = "available";
              activeProjectBySpace[space.id] = project.id;
              tabs.push(freshTerminalTab(project.id, root, allocId));
            } catch {
              activeProjectBySpace[space.id] = null;
            }
          }

          await saveSpacesList([space]);
          await saveProjectsList(projects);
          await saveActiveSpaceId(space.id);
          await saveActiveProjects(activeProjectBySpace);
          useSpaces
            .getState()
            .hydrate(
              [space],
              projects,
              space.id,
              activeProjectBySpace,
              availability,
            );
          const activeProjectId = activeProjectBySpace[space.id];
          setActiveProjectForNewTabs(activeProjectId);
          await adoptWorkspaceEnv(space.env);
          replaceTabs(tabs, tabs[0]?.id ?? null);
          return;
        }

        if (bootPlan.activeSpaceId === null) {
          useSpaces
            .getState()
            .hydrate(loaded.spaces, loaded.projects, null, {});
          setActiveProjectForNewTabs(null);
          replaceTabs([], null);
          return;
        }

        const activeSpaceId = bootPlan.activeSpaceId;
        const activeProjectBySpace: Record<string, string | null> = {};
        for (const space of loaded.spaces) {
          const selected = loaded.activeProjectBySpace[space.id];
          activeProjectBySpace[space.id] = loaded.projects.some(
            (project) =>
              project.id === selected && project.spaceId === space.id,
          )
            ? selected
            : (loaded.projects.find((project) => project.spaceId === space.id)
                ?.id ?? null);
        }

        const availability: Record<string, ProjectAvailability> = {};
        for (const project of loaded.projects) {
          const space = loaded.spaces.find(
            (candidate) => candidate.id === project.spaceId,
          );
          if (!space) {
            availability[project.id] = "unavailable";
            continue;
          }
          try {
            const root = await native.canonicalize(project.root, space.env);
            const stat = await native.fileStat(root, space.env);
            if (stat.kind !== "dir") throw new Error("not a directory");
            await native.workspaceAuthorize(root, space.env);
            availability[project.id] = "available";
          } catch {
            availability[project.id] = "unavailable";
          }
        }

        const restored: Tab[] = [];
        const initialActiveIndex: Record<string, number | null> = {};
        for (const project of loaded.projects) {
          const state = loaded.states.get(project.id);
          initialActiveIndex[project.id] = state?.activeTabIndex ?? null;
          if (state)
            restored.push(...hydrateTabs(state.tabs, project.id, allocId));
        }

        await Promise.allSettled(
          restored.flatMap((tab) => {
            if (availability[tab.projectId] !== "available") return [];
            const project = loaded.projects.find(
              (candidate) => candidate.id === tab.projectId,
            );
            const space = loaded.spaces.find(
              (candidate) => candidate.id === project?.spaceId,
            );
            if (!space) return [];
            return terminalCwds(tab).map((cwd) =>
              native.workspaceAuthorize(cwd, space.env),
            );
          }),
        );

        useSpaces
          .getState()
          .hydrate(
            loaded.spaces,
            loaded.projects,
            activeSpaceId,
            activeProjectBySpace,
            availability,
            initialActiveIndex,
          );
        const activeProjectId = activeSpaceId
          ? (activeProjectBySpace[activeSpaceId] ?? null)
          : null;
        setActiveProjectForNewTabs(activeProjectId);
        await adoptWorkspaceEnv(activeSpaceEnv(loaded.spaces, activeSpaceId));
        replaceTabs(
          restored,
          restoredActiveTabId(
            restored,
            activeProjectId,
            availability,
            initialActiveIndex,
          ),
        );
      } catch (error) {
        console.error("[terax] spaces boot failed:", error);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    launchCwd,
    allocId,
    replaceTabs,
    markBooted,
    setActiveProjectForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
