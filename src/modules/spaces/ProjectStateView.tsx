import { Button } from "@/components/ui/button";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProjectAvailability, ProjectMeta, SpaceMeta } from "./lib/store";

type Props = {
  activeSpace: SpaceMeta | null;
  activeProject: ProjectMeta | null;
  availability: ProjectAvailability | null;
  onCreateSpace(): void;
  onAddProject(spaceId: string): void;
  onNewTerminal(): void;
  onLocateProject(projectId: string): void;
  onRemoveProject(projectId: string): void;
};

export function ProjectStateView({
  activeSpace,
  activeProject,
  availability,
  onCreateSpace,
  onAddProject,
  onNewTerminal,
  onLocateProject,
  onRemoveProject,
}: Props) {
  let title = "No Spaces";
  let description = "Create a Space to organize Projects.";
  let actions = <Button onClick={onCreateSpace}>Create Space</Button>;

  if (activeSpace && !activeProject) {
    title = activeSpace.name;
    description = "This Space has no Projects.";
    actions = (
      <Button onClick={() => onAddProject(activeSpace.id)}>Add Project</Button>
    );
  } else if (activeProject && availability === "unavailable") {
    title = `${activeProject.name} is unavailable`;
    description = activeProject.root;
    actions = (
      <div className="flex gap-2">
        <Button onClick={() => onLocateProject(activeProject.id)}>
          Locate
        </Button>
        <Button
          variant="outline"
          onClick={() => onRemoveProject(activeProject.id)}
        >
          Remove Project
        </Button>
      </div>
    );
  } else if (activeProject) {
    title = activeProject.name;
    description = activeProject.root;
    actions = <Button onClick={onNewTerminal}>New Terminal</Button>;
  }

  return (
    <div className="flex h-full items-center justify-center bg-background/95 p-8">
      <div className="flex max-w-lg flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-muted-foreground">
          <HugeiconsIcon icon={Folder01Icon} size={24} strokeWidth={1.5} />
        </span>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </div>
    </div>
  );
}
