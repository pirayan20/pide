export type SidebarViewId = "explorer" | "source-control";
export type SidebarPosition = "left" | "right";
export type SidebarLayoutPart = "sidebar" | "handle" | "workspace";

export function sidebarLayoutOrder(
  position: SidebarPosition,
): SidebarLayoutPart[] {
  return position === "right"
    ? ["workspace", "handle", "sidebar"]
    : ["sidebar", "handle", "workspace"];
}
