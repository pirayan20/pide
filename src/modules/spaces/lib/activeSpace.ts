import type { WorkspaceEnv } from "@/modules/workspace";
import type { ProjectAvailability, ProjectMeta, SpaceMeta } from "./store";

export function findActiveSpace(
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta | null {
  if (activeId) {
    const found = spaces.find((s) => s.id === activeId);
    if (found) return found;
  }
  return spaces[0] ?? null;
}

export function activeProjectRoot(
  projects: ProjectMeta[],
  activeProjectId: string | null,
  availability: Record<string, ProjectAvailability>,
): string | null {
  if (!activeProjectId || availability[activeProjectId] !== "available") {
    return null;
  }
  return (
    projects.find((project) => project.id === activeProjectId)?.root ?? null
  );
}

export function activeSpaceEnv(
  spaces: SpaceMeta[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveSpace(spaces, activeId)?.env ?? { kind: "local" };
}
