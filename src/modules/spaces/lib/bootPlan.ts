import type { Tab } from "@/modules/tabs";
import type { ProjectAvailability, ProjectMeta, SpaceMeta } from "./store";

export type BootPlanInput = {
  versionMatched: boolean;
  spaces: SpaceMeta[];
  projects: ProjectMeta[];
  activeSpaceId: string | null;
  activeProjectBySpace: Record<string, string | null>;
  launchRoot: string | null;
};

export type BootPlan =
  | {
      kind: "restore";
      activeSpaceId: string | null;
      activeProjectId: string | null;
    }
  | { kind: "fresh-empty" }
  | { kind: "fresh-launch-project"; root: string };

export function planHierarchyBoot(input: BootPlanInput): BootPlan {
  if (!input.versionMatched) {
    return input.launchRoot
      ? { kind: "fresh-launch-project", root: input.launchRoot }
      : { kind: "fresh-empty" };
  }
  const activeSpaceId = input.spaces.some(
    (space) => space.id === input.activeSpaceId,
  )
    ? input.activeSpaceId
    : (input.spaces[0]?.id ?? null);
  if (!activeSpaceId) {
    return { kind: "restore", activeSpaceId: null, activeProjectId: null };
  }
  const selected = input.activeProjectBySpace[activeSpaceId];
  const activeProjectId = input.projects.some(
    (project) => project.id === selected && project.spaceId === activeSpaceId,
  )
    ? selected
    : (input.projects.find((project) => project.spaceId === activeSpaceId)
        ?.id ?? null);
  return { kind: "restore", activeSpaceId, activeProjectId };
}

export function restoredActiveTabId(
  tabs: Tab[],
  activeProjectId: string | null,
  availability: Record<string, ProjectAvailability>,
  initialActiveIndex: Record<string, number | null>,
): number | null {
  if (!activeProjectId || availability[activeProjectId] !== "available") {
    return null;
  }
  const owned = tabs.filter((tab) => tab.projectId === activeProjectId);
  const index = initialActiveIndex[activeProjectId] ?? 0;
  return owned[index ?? 0]?.id ?? owned[0]?.id ?? null;
}
