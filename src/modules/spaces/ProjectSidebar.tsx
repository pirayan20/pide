import {
  projectOrderAfterDrop,
  type DropSide,
} from "@/modules/spaces/lib/projectOrder";
import { useProjectDrag } from "@/modules/spaces/lib/useProjectDrag";
import { sumProjectActivity } from "@/modules/spaces/lib/projectActivity";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { useProjectActivity } from "@/modules/spaces/lib/useProjectActivity";
import { native } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { Tab } from "@/modules/tabs";
import type { ProjectActivity } from "@/modules/spaces/lib/projectActivity";
import { ProjectActivityBadge } from "@/modules/spaces/components/ProjectActivityBadge";
import {
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { InlineRename } from "./components/InlineRename";
import type { ProjectAvailability, ProjectMeta, SpaceMeta } from "./lib/store";
import { useSpaces } from "./lib/useSpaces";
import { SpaceAvatar } from "./SpaceAvatar";

type Props = {
  open: boolean;
  tabs: Tab[];
  activeBranch?: string;
  onNewSpace(): void;
  onDeleteSpace(id: string): void;
  onAddProject(spaceId: string): void;
  onLocateProject(projectId: string): void;
  onRemoveProject(projectId: string): void;
  onSelectProject(projectId: string): void;
  projectTabCounts: Record<string, number>;
  onReorderSpaces(ids: string[]): void;
  onReorderProjects(spaceId: string, ids: string[]): void;
};

type TreeActions = {
  toggleSpace(id: string): void;
  selectSpace(id: string): void;
  selectProject(id: string): void;
  renameSpace(id: string, name: string): void;
  renameProject(id: string, name: string): void;
  addProject(spaceId: string): void;
  locateProject(projectId: string): void;
  removeProject(projectId: string): void;
  deleteSpace(spaceId: string): void;
  dragSpace(id: string): void;
  dropSpace(id: string): void;
  dragProject(id: string): void;
  dropProject(spaceId: string, id: string, side: DropSide): void;
};

type TreeProps = {
  spaces: SpaceMeta[];
  projects: ProjectMeta[];
  activeSpaceId: string | null;
  activeProjectId: string | null;
  availability: Record<string, ProjectAvailability>;
  projectBranches: Record<string, string>;
  projectTabCounts: Record<string, number>;
  expanded: Set<string>;
  actions: TreeActions;
  projectActivity?: Record<string, ProjectActivity>;
};

function ActionButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick(): void;
  icon: typeof Delete02Icon;
}) {
  return (
    <button
      type="button"
      data-project-action
      title={label}
      aria-label={label}
      className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}

export function SpaceProjectTree({
  spaces,
  projects,
  activeSpaceId,
  activeProjectId,
  availability,
  projectBranches,
  projectTabCounts,
  expanded,
  actions,
  projectActivity = {},
}: TreeProps) {
  const projectDrag = useProjectDrag(actions.dropProject, actions.dragProject);
  const [editing, setEditing] = useState<{
    kind: "space" | "project";
    id: string;
  } | null>(null);

  return (
    <div
      className="space-y-1"
      onClickCapture={(event) => {
        if (projectDrag.suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          projectDrag.suppressClick.current = false;
        }
      }}
    >
      {spaces.map((space) => {
        const open = expanded.has(space.id);
        const children = projects.filter(
          (project) => project.spaceId === space.id,
        );
        return (
          <Collapsible
            open={open}
            key={space.id}
            role="group"
            aria-label={space.name}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => actions.dropSpace(space.id)}
            className={cn(
              "pide-project-row group/space rounded-lg border border-transparent",
              space.id === activeSpaceId && "text-foreground",
            )}
          >
            <div
              role="toolbar"
              aria-label={`${space.name} Space controls`}
              className="relative flex h-9 items-center gap-1 px-1.5"
              draggable
              onDragStart={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("input, [data-project-action]")
                ) {
                  event.preventDefault();
                  return;
                }
                event.stopPropagation();
                actions.dragSpace(space.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", space.id);
              }}
            >
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.05]"
                aria-label={`${open ? "Collapse" : "Expand"} Space ${space.name}`}
                aria-expanded={open}
                onClick={() => actions.toggleSpace(space.id)}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className={cn("pide-space-chevron", open && "rotate-90")}
                  size={13}
                  strokeWidth={1.75}
                />
              </button>
              <SpaceAvatar
                space={space}
                size="sm"
                active={space.id === activeSpaceId}
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {editing?.kind === "space" && editing.id === space.id ? (
                  <InlineRename
                    initial={space.name}
                    onCommit={(name) => {
                      const value = name.trim();
                      if (value) actions.renameSpace(space.id, value);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 truncate text-left text-xs font-semibold"
                    onClick={() => actions.selectSpace(space.id)}
                  >
                    {space.name}
                  </button>
                )}
                <ProjectActivityBadge
                  activity={children.reduce(
                    (sum, project) => {
                      const activity =
                        availability[project.id] === "available"
                          ? projectActivity[project.id]
                          : undefined;
                      return sumProjectActivity(sum, activity);
                    },
                    { working: 0, waiting: 0 },
                  )}
                />
              </div>
              <span className="pide-project-actions flex shrink-0 rounded bg-card opacity-0 pointer-events-none group-hover/space:opacity-100 group-hover/space:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                <ActionButton
                  label="Rename Space"
                  icon={PencilEdit02Icon}
                  onClick={() => setEditing({ kind: "space", id: space.id })}
                />
                <ActionButton
                  label="Add Project"
                  icon={PlusSignIcon}
                  onClick={() => actions.addProject(space.id)}
                />
                <ActionButton
                  label="Delete Space"
                  icon={Delete02Icon}
                  onClick={() => actions.deleteSpace(space.id)}
                />
              </span>
            </div>

            <CollapsibleContent
              className="pide-collapsible-content"
              inert={!open}
            >
              <div className="space-y-0.5 px-1.5 pb-1.5 pl-3">
                {children.length === 0 ? (
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-foreground/[0.05]"
                    onClick={() => actions.addProject(space.id)}
                  >
                    Add Project
                  </button>
                ) : (
                  children.map((project) => {
                    const unavailable =
                      availability[project.id] === "unavailable";
                    const empty = (projectTabCounts[project.id] ?? 0) === 0;
                    const branch = projectBranches[project.id];
                    return (
                      <div
                        key={project.id}
                        role="group"
                        aria-label={project.name}
                        data-project-empty={empty ? "true" : undefined}
                        data-project-id={project.id}
                        data-space-id={space.id}
                        draggable={false}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) =>
                          projectDrag.start(event, project.id, space.id)
                        }
                        onPointerMove={projectDrag.move}
                        onPointerUp={projectDrag.end}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") projectDrag.cancel();
                        }}
                        onPointerCancel={projectDrag.cancel}
                        onLostPointerCapture={projectDrag.cancel}
                        className={cn(
                          "pide-project-row group/project relative select-none touch-none flex min-h-11 items-center gap-2 rounded-md px-2",
                          project.id === activeProjectId
                            ? "bg-foreground/[0.07] text-foreground before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-full before:bg-muted-foreground/60"
                            : "hover:bg-foreground/[0.04]",
                          projectDrag.draggingId === project.id &&
                            "opacity-40 cursor-grabbing",
                          unavailable && "text-muted-foreground",
                          empty && "opacity-55",
                        )}
                      >
                        {projectDrag.target?.id === project.id && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-muted-foreground",
                              projectDrag.target.side === "before"
                                ? "-top-px"
                                : "-bottom-px",
                            )}
                          />
                        )}
                        {editing?.kind === "project" &&
                        editing.id === project.id ? (
                          <span className="min-w-0 flex-1">
                            <InlineRename
                              initial={project.name}
                              ariaLabel="Rename Project"
                              onCommit={(name) => {
                                const value = name.trim();
                                if (value) {
                                  actions.renameProject(project.id, value);
                                }
                                setEditing(null);
                              }}
                              onCancel={() => setEditing(null)}
                            />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            aria-current={
                              project.id === activeProjectId
                                ? "page"
                                : undefined
                            }
                            title={project.root}
                            onClick={() => actions.selectProject(project.id)}
                          >
                            <span className="relative shrink-0">
                              <HugeiconsIcon
                                icon={Folder01Icon}
                                size={14}
                                strokeWidth={1.75}
                                className={
                                  unavailable ? "text-destructive" : ""
                                }
                              />
                              {availability[project.id] === "available" && (
                                <ProjectActivityBadge
                                  activity={projectActivity[project.id]}
                                  className="absolute -bottom-1 -right-1"
                                />
                              )}
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">
                                {project.name}
                              </span>
                              {unavailable || branch ? (
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {unavailable ? "Folder unavailable" : branch}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        )}
                        {!empty && (
                          <span
                            title={`${projectTabCounts[project.id]} open tabs`}
                            className="text-[10px] tabular-nums text-muted-foreground"
                          >
                            {projectTabCounts[project.id]}
                          </span>
                        )}
                        <span className="pide-project-actions absolute right-1 flex rounded bg-card opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                          <ActionButton
                            label="Rename Project"
                            icon={PencilEdit02Icon}
                            onClick={() =>
                              setEditing({ kind: "project", id: project.id })
                            }
                          />
                          {unavailable ? (
                            <ActionButton
                              label="Locate Project"
                              icon={Refresh01Icon}
                              onClick={() => actions.locateProject(project.id)}
                            />
                          ) : null}
                          <ActionButton
                            label="Remove Project"
                            icon={Delete02Icon}
                            onClick={() => actions.removeProject(project.id)}
                          />
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

function moveBefore(
  ids: string[],
  movedId: string,
  targetId: string,
): string[] {
  if (movedId === targetId) return ids;
  const next = ids.filter((id) => id !== movedId);
  const index = next.indexOf(targetId);
  if (index < 0) return ids;
  next.splice(index, 0, movedId);
  return next;
}

export function ProjectSidebar({
  open,
  tabs,
  activeBranch,
  onNewSpace,
  onDeleteSpace,
  onAddProject,
  onLocateProject,
  onRemoveProject,
  onSelectProject,
  projectTabCounts,
  onReorderSpaces,
  onReorderProjects,
}: Props) {
  const spaces = useSpaces((state) => state.spaces);
  const projects = useSpaces((state) => state.projects);
  const availability = useSpaces((state) => state.availability);
  const activeSpaceId = useSpaces((state) => state.activeSpaceId);
  const activeProjectId = useSpaces((state) =>
    state.activeSpaceId
      ? (state.activeProjectBySpace[state.activeSpaceId] ?? null)
      : null,
  );
  const setActiveSpace = useSpaces((state) => state.setActiveSpace);
  const renameSpace = useSpaces((state) => state.renameSpace);
  const renameProject = useSpaces((state) => state.renameProject);
  const [query, setQuery] = useState("");
  const projectActivity = useProjectActivity(tabs);
  const [expanded, setExpanded] = useState(
    () => new Set(activeSpaceId ? [activeSpaceId] : []),
  );
  const [projectBranches, setProjectBranches] = useState<
    Record<string, string>
  >({});
  const draggedSpace = useRef<string | null>(null);
  const draggedProject = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !activeSpaceId) return;
    setExpanded((current) => {
      if (current.has(activeSpaceId)) return current;
      const next = new Set(current);
      next.add(activeSpaceId);
      return next;
    });
  }, [open, activeSpaceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      projects.map(async (project) => {
        if (availability[project.id] !== "available") return null;
        const space = spaces.find(
          (candidate) => candidate.id === project.spaceId,
        );
        if (!space) return null;
        const repo = await native
          .gitResolveRepo(project.root, space.env)
          .catch(() => null);
        return repo ? ([project.id, repo.branch] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setProjectBranches(
        Object.fromEntries(entries.filter((entry) => entry !== null)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, projects, spaces, availability]);

  const activeSpace = spaces.find((space) => space.id === activeSpaceId);
  const filteredProjects = projects.filter((project) => {
    const term = query.trim().toLowerCase();
    const space = spaces.find((candidate) => candidate.id === project.spaceId);
    return (
      !term ||
      project.name.toLowerCase().includes(term) ||
      space?.name.toLowerCase().includes(term)
    );
  });
  const filteredSpaces = spaces.filter(
    (space) =>
      !query.trim() ||
      filteredProjects.some((project) => project.spaceId === space.id) ||
      space.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const actions: TreeActions = {
    toggleSpace: (id) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectSpace: (id) => {
      setActiveSpace(id);
    },
    selectProject: (id) => {
      onSelectProject(id);
    },
    renameSpace,
    renameProject,
    addProject: onAddProject,
    locateProject: onLocateProject,
    removeProject: onRemoveProject,
    deleteSpace: onDeleteSpace,
    dragSpace: (id) => {
      draggedSpace.current = id;
      draggedProject.current = null;
    },
    dropSpace: (id) => {
      if (draggedSpace.current) {
        onReorderSpaces(
          moveBefore(
            spaces.map((space) => space.id),
            draggedSpace.current,
            id,
          ),
        );
      }
      draggedSpace.current = null;
    },
    dragProject: (id) => {
      draggedProject.current = id;
      draggedSpace.current = null;
    },
    dropProject: (spaceId, id, side) => {
      const moved = draggedProject.current;
      const order = moved
        ? projectOrderAfterDrop(projects, spaceId, moved, id, side)
        : null;
      if (order) onReorderProjects(spaceId, order);
      draggedProject.current = null;
    },
  };

  return (
    <aside
      aria-label="Projects"
      className={cn(
        "pide-sidebar-content h-full min-h-0 flex-col border-r border-border/60 bg-card text-foreground",
        open ? "flex" : "hidden",
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold">Projects</span>
        <ActionButton
          label="New Space"
          icon={PlusSignIcon}
          onClick={onNewSpace}
        />
      </div>
      <div className="shrink-0 px-3 pb-3">
        <input
          aria-label="Find a project"
          placeholder="Find a project..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 w-full rounded-md border border-border bg-background/40 px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div data-project-scroll className="min-h-0 flex-1 overflow-y-auto px-2">
        {spaces.length === 0 ? (
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-border p-6 text-xs text-muted-foreground hover:bg-foreground/[0.05]"
            onClick={onNewSpace}
          >
            Create Space
          </button>
        ) : filteredSpaces.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No projects found.
          </p>
        ) : (
          <SpaceProjectTree
            spaces={filteredSpaces}
            projects={filteredProjects}
            activeSpaceId={activeSpaceId}
            activeProjectId={activeProjectId}
            availability={availability}
            projectBranches={
              activeProjectId && activeBranch !== undefined
                ? { ...projectBranches, [activeProjectId]: activeBranch }
                : projectBranches
            }
            projectTabCounts={projectTabCounts}
            projectActivity={projectActivity}
            expanded={
              query.trim()
                ? new Set(filteredSpaces.map((space) => space.id))
                : expanded
            }
            actions={actions}
          />
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-border/60 px-3 text-[11px] text-muted-foreground">
        <span className="truncate">
          {activeSpace?.env.kind === "wsl" ? activeSpace.env.distro : "Local"}
        </span>
        {activeSpaceId && (
          <button
            type="button"
            onClick={() => onAddProject(activeSpaceId)}
            className="shrink-0 rounded px-1 py-1 hover:bg-foreground/[0.05] hover:text-foreground"
          >
            + Add project
          </button>
        )}
      </div>
    </aside>
  );
}
