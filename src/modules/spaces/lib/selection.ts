type ProjectOwner = { id: string; spaceId: string };

export function nextProjectAfterRemoval(
  projects: ProjectOwner[],
  removedId: string,
  spaceId: string,
): string | null {
  const siblings = projects.filter((project) => project.spaceId === spaceId);
  const index = siblings.findIndex((project) => project.id === removedId);
  if (index < 0) return siblings[0]?.id ?? null;
  return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? null;
}

export function nextSpaceAfterRemoval(
  orderedIds: string[],
  removedId: string,
): string | null {
  const index = orderedIds.indexOf(removedId);
  if (index < 0) return orderedIds[0] ?? null;
  return orderedIds[index + 1] ?? orderedIds[index - 1] ?? null;
}
