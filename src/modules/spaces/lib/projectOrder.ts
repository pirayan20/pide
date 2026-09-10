export type DropSide = "before" | "after";

export function projectOrderAfterDrop(
  projects: readonly { id: string; spaceId: string }[],
  spaceId: string,
  movedId: string,
  targetId: string,
  side: DropSide,
): string[] | null {
  const ids = projects
    .filter((project) => project.spaceId === spaceId)
    .map((project) => project.id);
  if (movedId === targetId || !ids.includes(movedId) || !ids.includes(targetId))
    return null;
  const next = ids.filter((id) => id !== movedId);
  next.splice(next.indexOf(targetId) + (side === "after" ? 1 : 0), 0, movedId);
  return next.every((id, index) => id === ids[index]) ? null : next;
}
