import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { native } from "@/lib/native";
import { cn } from "@/lib/utils";
import { useShortcutLabel } from "@/modules/shortcuts";
import {
  ArrowDown01Icon,
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
  onOpenChange(open: boolean): void;
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
  dropProject(spaceId: string, id: string): void;
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
      title={label}
      aria-label={label}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
}: TreeProps) {
  const [editing, setEditing] = useState<{
    kind: "space" | "project";
    id: string;
  } | null>(null);

  return (
    <div role="tree" className="max-h-[60vh] space-y-1 overflow-y-auto">
      {spaces.map((space) => {
        const open = expanded.has(space.id);
        const children = projects.filter(
          (project) => project.spaceId === space.id,
        );
        return (
          <div
            key={space.id}
            role="treeitem"
            tabIndex={-1}
            draggable
            onDragStart={() => actions.dragSpace(space.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => actions.dropSpace(space.id)}
            className={cn(
              "rounded-lg border border-transparent",
              space.id === activeSpaceId && "border-border/70 bg-accent/30",
            )}
          >
            <div className="flex h-9 items-center gap-1 px-1.5">
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label={open ? "Collapse Space" : "Expand Space"}
                onClick={() => actions.toggleSpace(space.id)}
              >
                <HugeiconsIcon
                  icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                  size={13}
                  strokeWidth={1.75}
                />
              </button>
              <SpaceAvatar
                space={space}
                size="sm"
                active={space.id === activeSpaceId}
              />
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
                  className="min-w-0 flex-1 truncate text-left text-xs font-semibold"
                  onClick={() => actions.selectSpace(space.id)}
                >
                  {space.name}
                </button>
              )}
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
            </div>

            {open ? (
              <div className="space-y-0.5 px-1.5 pb-1.5 pl-8">
                {children.length === 0 ? (
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
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
                        role="treeitem"
                        data-project-empty={empty ? "true" : undefined}
                        tabIndex={-1}
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          actions.dragProject(project.id);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.stopPropagation();
                          actions.dropProject(space.id, project.id);
                        }}
                        className={cn(
                          "group flex min-h-9 items-center gap-2 rounded-md px-2",
                          project.id === activeProjectId
                            ? "bg-accent text-foreground"
                            : "hover:bg-accent/60",
                          unavailable && "text-muted-foreground",
                          empty && "opacity-55",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => actions.selectProject(project.id)}
                        >
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={14}
                            strokeWidth={1.75}
                            className={unavailable ? "text-destructive" : ""}
                          />
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
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">
                                {project.name}
                              </span>
                              {branch ? (
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {branch}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </button>
                        <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
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
            ) : null}
          </div>
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

export function SpaceSwitcher({
  open,
  onOpenChange,
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
  const shortcut = useShortcutLabel("space.overview");
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
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const label = activeProject
    ? `${activeSpace?.name ?? "Space"} / ${activeProject.name}`
    : (activeSpace?.name ?? "Create Space");

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
      onOpenChange(false);
    },
    selectProject: (id) => {
      onSelectProject(id);
      onOpenChange(false);
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
    dropProject: (spaceId, id) => {
      const moved = draggedProject.current;
      const siblings = projects.filter(
        (project) => project.spaceId === spaceId,
      );
      if (moved && siblings.some((project) => project.id === moved)) {
        onReorderProjects(
          spaceId,
          moveBefore(
            siblings.map((project) => project.id),
            moved,
            id,
          ),
        );
      }
      draggedProject.current = null;
    },
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={shortcut ? `Spaces and Projects - ${shortcut}` : label}
          className="flex h-7 max-w-64 shrink-0 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <span className="truncate">{label}</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 opacity-65"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[22rem] p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold">Spaces and Projects</span>
          <span className="flex items-center gap-1">
            {shortcut ? (
              <Kbd className="h-5 text-[10px]">{shortcut}</Kbd>
            ) : null}
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New Space"
              aria-label="New Space"
              onClick={onNewSpace}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
            </button>
          </span>
        </div>
        {spaces.length === 0 ? (
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground hover:bg-accent"
            onClick={onNewSpace}
          >
            Create Space
          </button>
        ) : (
          <SpaceProjectTree
            spaces={spaces}
            projects={projects}
            activeSpaceId={activeSpaceId}
            activeProjectId={activeProjectId}
            availability={availability}
            projectBranches={projectBranches}
            projectTabCounts={projectTabCounts}
            expanded={expanded}
            actions={actions}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
