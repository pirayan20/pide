const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function cancelSidebarMotion(group: HTMLElement) {
  const timer = pending.get(group);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(group);
  delete group.dataset.sidebarMotion;
}

export function animateSidebarLayout(panelId: string, change: () => void) {
  const group = document.getElementById(panelId)?.parentElement;
  if (!group || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  cancelSidebarMotion(group);
  group.dataset.sidebarMotion = "true";
  change();
  pending.set(
    group,
    setTimeout(() => cancelSidebarMotion(group), 240),
  );
}

export function isSidebarAnimating(panelId: string): boolean {
  return (
    document.getElementById(panelId)?.parentElement?.dataset.sidebarMotion ===
    "true"
  );
}
