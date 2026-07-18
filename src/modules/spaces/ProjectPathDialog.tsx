import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type ProjectPathDialogProps = {
  open: boolean;
  mode: "add" | "locate";
  spaceName: string;
  allowBrowse: boolean;
  initialPath?: string;
  error: string | null;
  submitting: boolean;
  onOpenChange(open: boolean): void;
  onBrowse(): Promise<string | null>;
  onSubmit(path: string): Promise<void>;
};

export function ProjectPathDialog({
  open,
  mode,
  spaceName,
  allowBrowse,
  initialPath,
  error,
  submitting,
  onOpenChange,
  onBrowse,
  onSubmit,
}: ProjectPathDialogProps) {
  const [path, setPath] = useState(initialPath ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPath(initialPath ?? "");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, initialPath]);

  const submit = async () => {
    const value = path.trim();
    if (value) await onSubmit(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.75} />
            {mode === "add" ? "Add Project" : "Locate Project"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? `Choose a folder for ${spaceName}.`
              : "Choose the Project's current folder."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={path}
            aria-label="Project path"
            placeholder={allowBrowse ? "/path/to/project" : "/home/me/project"}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {allowBrowse ? (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                void onBrowse().then((selected) => {
                  if (selected) setPath(selected);
                });
              }}
            >
              Browse
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || path.trim().length === 0}
            onClick={() => void submit()}
          >
            {submitting
              ? "Working..."
              : mode === "add"
                ? "Add Project"
                : "Locate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
