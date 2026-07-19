import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  type GitStashEntry,
  type GitStatusSnapshot,
  native,
} from "@/lib/native";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle01Icon,
  Delete02Icon,
  Download01Icon,
  Edit02Icon,
  Folder01Icon,
  FolderCloudIcon,
  FolderGitTwoIcon,
  GitBranchIcon,
  GitMergeIcon,
  MoreVerticalIcon,
  Package01Icon,
  PlusSignIcon,
  Refresh01Icon,
  RemoveSquareIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  SourceControlRemoteAction,
  SourceControlSummary,
} from "./useSourceControl";
import {
  useSourceControlPanel,
  type CheckState,
  type SourceControlFileEntry,
  type SourceControlLastOperation,
} from "./useSourceControlPanel";

type Props = {
  open: boolean;
  sourceControl: SourceControlSummary;
  onOpenGitGraph?: () => void;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenFile?: (absolutePath: string) => void;
  onNavigateToPath?: (path: string) => void;
};

const SOURCE_CONTROL_TOOLTIP_CLASS =
  "border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100";

const ROW_HEIGHTS = {
  banner: 32,
  header: 30,
  entry: 30,
} as const;

type RowDescriptor =
  | { kind: "banner-diverged"; key: string }
  | { kind: "list-header"; key: string; count: number }
  | { kind: "entry"; key: string; entry: SourceControlFileEntry };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function entryPathLabel(entry: SourceControlFileEntry): string {
  if (entry.originalPath) return `${entry.originalPath} → ${entry.path}`;
  return dirname(entry.path);
}

function upstreamBadgeLabel(upstream: string | null | undefined): string {
  if (!upstream) return "No upstream";
  return upstream;
}

function statusAccent(code: string): string {
  switch (code) {
    case "A":
      return "bg-emerald-500/85";
    case "U":
      return "bg-teal-500/85";
    case "M":
      return "bg-amber-500/85";
    case "D":
      return "bg-rose-500/85";
    case "R":
      return "bg-sky-500/85";
    default:
      return "bg-muted-foreground/40";
  }
}

function checkboxValue(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}

function relativeTime(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isAuthError(message: string): boolean {
  return message.toLowerCase().includes("authentication required");
}

const REMOTE_ACTION_LABELS: Record<SourceControlRemoteAction, string> = {
  fetch: "Fetch origin",
  pull: "Pull origin",
  push: "Push origin",
};

type PendingSwitch =
  | { kind: "checkout"; branch: string }
  | { kind: "create"; name: string };

function BranchDropdown({
  repoRoot,
  repoLabel,
  currentBranch,
  changedCount,
  busy,
  onNavigateToPath,
  onRefresh,
  onConflicts,
}: {
  repoRoot: string | null;
  repoLabel: string;
  currentBranch: string | null;
  changedCount: number;
  busy: boolean;
  onNavigateToPath?: (path: string) => void;
  onRefresh: () => void;
  onConflicts: (title: string, files: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyLocal, setBusyLocal] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(
    null,
  );
  const [switchChoice, setSwitchChoice] = useState<"bring" | "leave">("bring");
  const requestRef = useRef(0);
  const opInFlight = useRef(false);

  const loadBranches = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setBranches([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitListBranches(repoRoot);
      if (id !== requestRef.current) return;
      setBranches(result.branches);
    } catch (e) {
      if (id !== requestRef.current) return;
      setError(String(e));
      setBranches([]);
    } finally {
      if (id === requestRef.current) {
        setLoading(false);
      }
    }
  }, [repoRoot]);

  useEffect(() => {
    if (open) {
      void loadBranches();
    }
  }, [open, loadBranches]);

  const runOp = useCallback(async (fn: () => Promise<unknown>) => {
    if (opInFlight.current) return;
    opInFlight.current = true;
    setBusyLocal(true);
    try {
      await fn();
    } finally {
      opInFlight.current = false;
      setBusyLocal(false);
    }
  }, []);

  // Return true on success so the bring/leave flow can tell whether a checkout
  // that followed a stash actually landed (and roll the stash back if it didn't).
  const performCheckout = useCallback(
    async (branch: string): Promise<boolean> => {
      if (!repoRoot) return false;
      try {
        await native.gitCheckoutBranch(repoRoot, branch);
        setBranches([]);
        setOpen(false);
        onRefresh();
        return true;
      } catch (e) {
        toast.error(String(e));
        return false;
      }
    },
    [repoRoot, onRefresh],
  );

  const performCreate = useCallback(
    async (name: string): Promise<boolean> => {
      if (!repoRoot) return false;
      try {
        await native.gitCreateBranch(repoRoot, name, true, null);
        setNewBranchName("");
        setOpen(false);
        onRefresh();
        return true;
      } catch (e) {
        toast.error(String(e));
        return false;
      }
    },
    [repoRoot, onRefresh],
  );

  const requestCheckout = useCallback(
    (branch: string) => {
      if (branch === currentBranch) {
        setOpen(false);
        return;
      }
      if (changedCount > 0) {
        setOpen(false);
        setSwitchChoice("bring");
        setPendingSwitch({ kind: "checkout", branch });
        return;
      }
      void runOp(() => performCheckout(branch));
    },
    [changedCount, currentBranch, performCheckout, runOp],
  );

  const requestCreate = useCallback(() => {
    const name = newBranchName.trim();
    if (!name) return;
    setNewBranchOpen(false);
    if (changedCount > 0) {
      setSwitchChoice("bring");
      setPendingSwitch({ kind: "create", name });
      return;
    }
    void runOp(() => performCreate(name));
  }, [changedCount, newBranchName, performCreate, runOp]);

  const confirmPendingSwitch = useCallback(() => {
    if (!repoRoot || !pendingSwitch) return;
    const target = pendingSwitch;
    const leaveChanges = switchChoice === "leave";
    setPendingSwitch(null);
    void runOp(async () => {
      try {
        let stashedSha: string | null = null;
        if (leaveChanges) {
          const res = await native.gitStashSave(repoRoot, null, true);
          stashedSha = res.stashed ? res.sha : null;
        }
        const ok =
          target.kind === "checkout"
            ? await performCheckout(target.branch)
            : await performCreate(target.name);
        // If we stashed the changes to "leave" them, but the switch failed, the
        // work would be stranded in an unlabeled stash. Restore exactly that
        // stash so the user is back where they started rather than silently
        // losing their changes.
        if (!ok && stashedSha) {
          await native
            .gitStashApply(repoRoot, stashedSha, true)
            .catch(() => {});
          toast.error("Branch switch failed — your changes were restored.");
        }
      } catch (e) {
        toast.error(String(e));
      }
    });
  }, [
    performCheckout,
    performCreate,
    pendingSwitch,
    repoRoot,
    runOp,
    switchChoice,
  ]);

  const openRename = useCallback((branch: string) => {
    setRenameTarget(branch);
    setRenameValue(branch);
  }, []);

  const confirmRename = useCallback(() => {
    if (!repoRoot || !renameTarget) return;
    const newName = renameValue.trim();
    const oldName = renameTarget;
    setRenameTarget(null);
    if (!newName || newName === oldName) return;
    void runOp(async () => {
      try {
        await native.gitRenameBranch(repoRoot, oldName, newName);
        onRefresh();
      } catch (e) {
        toast.error(String(e));
      }
    });
  }, [onRefresh, renameTarget, renameValue, repoRoot, runOp]);

  const confirmDelete = useCallback(() => {
    if (!repoRoot || !deleteTarget) return;
    const name = deleteTarget;
    setDeleteTarget(null);
    void runOp(async () => {
      try {
        await native.gitDeleteBranch(repoRoot, name, false);
        onRefresh();
      } catch (e) {
        toast.error(String(e));
      }
    });
  }, [deleteTarget, onRefresh, repoRoot, runOp]);

  const handleMerge = useCallback(
    (branch: string) => {
      if (!repoRoot) return;
      void runOp(async () => {
        try {
          const result = await native.gitMergeBranch(repoRoot, branch);
          onRefresh();
          if (result.hadConflicts) {
            onConflicts(
              `Merge conflicts merging "${branch}"`,
              result.conflictedFiles,
            );
          } else if (result.merged) {
            toast.success(result.message || `Merged ${branch}.`);
          } else {
            toast.error(result.message || `Merge of ${branch} did nothing.`);
          }
        } catch (e) {
          toast.error(String(e));
        }
      });
    },
    [onConflicts, onRefresh, repoRoot, runOp],
  );

  const localBranches = useMemo(
    () => branches.filter((b) => b.kind === "local"),
    [branches],
  );
  const worktrees = useMemo(
    () => branches.filter((b) => b.kind === "worktree"),
    [branches],
  );

  const disabled = busy || busyLocal;
  const switchTargetLabel =
    pendingSwitch?.kind === "checkout"
      ? pendingSwitch.branch
      : pendingSwitch?.kind === "create"
        ? pendingSwitch.name
        : "";

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-70"
          >
            <HugeiconsIcon
              icon={FolderGitTwoIcon}
              size={12}
              strokeWidth={1.9}
              className="shrink-0 text-muted-foreground"
            />
            <span className="max-w-35 truncate">{repoLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem
            disabled={!repoRoot || disabled}
            onSelect={(e) => {
              e.preventDefault();
              setOpen(false);
              setNewBranchName("");
              setNewBranchOpen(true);
            }}
            className="flex cursor-pointer items-center gap-2 text-[12px] font-medium"
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              size={13}
              strokeWidth={2}
              className="shrink-0"
            />
            New branch…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              Loading branches…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
              {error}
            </div>
          ) : (
            <>
              {localBranches.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                    Local Branches
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {localBranches.map((b) => (
                      <div key={b.name} className="flex items-center gap-0.5">
                        <DropdownMenuItem
                          disabled={disabled}
                          onSelect={(e) => {
                            e.preventDefault();
                            requestCheckout(b.name);
                          }}
                          className="flex flex-1 cursor-pointer items-center gap-2 text-[12px]"
                        >
                          {b.isHead ? (
                            <HugeiconsIcon
                              icon={Tick02Icon}
                              size={14}
                              strokeWidth={1.8}
                              className="shrink-0"
                            />
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {b.name}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger
                            disabled={disabled}
                            onSelect={(e) => e.preventDefault()}
                            aria-label={`${b.name} branch actions`}
                            className="shrink-0 !px-1.5 !py-1.5"
                          >
                            <HugeiconsIcon
                              icon={MoreVerticalIcon}
                              size={12}
                              strokeWidth={1.9}
                            />
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {!b.isHead && (
                              <DropdownMenuItem
                                disabled={disabled}
                                onSelect={() => handleMerge(b.name)}
                                className="flex cursor-pointer items-center gap-2 text-[12px]"
                              >
                                <HugeiconsIcon
                                  icon={GitMergeIcon}
                                  size={13}
                                  strokeWidth={1.8}
                                  className="shrink-0"
                                />
                                Merge into current
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              disabled={disabled}
                              onSelect={(e) => {
                                e.preventDefault();
                                setOpen(false);
                                openRename(b.name);
                              }}
                              className="flex cursor-pointer items-center gap-2 text-[12px]"
                            >
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                size={13}
                                strokeWidth={1.8}
                                className="shrink-0"
                              />
                              Rename…
                            </DropdownMenuItem>
                            {!b.isHead && (
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={disabled}
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setOpen(false);
                                  setDeleteTarget(b.name);
                                }}
                                className="flex cursor-pointer items-center gap-2 text-[12px]"
                              >
                                <HugeiconsIcon
                                  icon={Delete02Icon}
                                  size={13}
                                  strokeWidth={1.8}
                                  className="shrink-0"
                                />
                                Delete…
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </div>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              {worktrees.length > 0 && (
                <>
                  {localBranches.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                    Worktrees
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {worktrees.map((b) => (
                      <DropdownMenuItem
                        key={b.worktreePath ?? b.name}
                        onSelect={() => {
                          if (b.worktreePath && onNavigateToPath) {
                            onNavigateToPath(b.worktreePath);
                          }
                        }}
                        className="flex cursor-pointer items-center gap-2 text-[12px]"
                      >
                        <HugeiconsIcon
                          icon={Folder01Icon}
                          size={14}
                          strokeWidth={1.5}
                          className="shrink-0 text-muted-foreground"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{b.name}</span>
                          {b.worktreePath && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {b.worktreePath}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              {branches.length === 0 && (
                <div className="px-3 py-3 text-[11px] text-muted-foreground">
                  No branches found.
                </div>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Create a new branch from{" "}
              {currentBranch ? `"${currentBranch}"` : "the current commit"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="scm-new-branch-name">Name</Label>
            <Input
              id="scm-new-branch-name"
              autoFocus
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  requestCreate();
                }
              }}
              placeholder="feature/my-branch"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBranchOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newBranchName.trim()}
              onClick={() => requestCreate()}
            >
              Create branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
            <DialogDescription>Rename "{renameTarget}".</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="scm-rename-branch-name">New name</Label>
            <Input
              id="scm-rename-branch-name"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => confirmRename()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete branch?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Delete "${deleteTarget}"? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => {
          if (!o) setPendingSwitch(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              You have {changedCount} uncommitted{" "}
              {changedCount === 1 ? "change" : "changes"}
            </DialogTitle>
            <DialogDescription>
              {pendingSwitch?.kind === "create"
                ? `Creating "${switchTargetLabel}". What should happen to your changes?`
                : `Switching to "${switchTargetLabel}". What should happen to your changes?`}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={switchChoice}
            onValueChange={(v) => setSwitchChoice(v as "bring" | "leave")}
            className="gap-2"
          >
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                switchChoice === "bring"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60",
              )}
            >
              <RadioGroupItem value="bring" className="mt-0.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12.5px] font-medium text-foreground">
                  Bring my changes to {switchTargetLabel}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Move the working-tree changes onto the branch you're switching
                  to.
                </span>
              </div>
            </label>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                switchChoice === "leave"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60",
              )}
            >
              <RadioGroupItem value="leave" className="mt-0.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12.5px] font-medium text-foreground">
                  Leave my changes on {currentBranch ?? "this branch"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Stash them, then restore from the Stash menu whenever you're
                  ready.
                </span>
              </div>
            </label>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSwitch(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirmPendingSwitch()}>
              {pendingSwitch?.kind === "create"
                ? "Create branch"
                : "Switch branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StashMenu({
  repoRoot,
  changedCount,
  busy,
  onRefresh,
  onConflicts,
}: {
  repoRoot: string | null;
  changedCount: number;
  busy: boolean;
  onRefresh: () => void;
  onConflicts: (title: string, files: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyLocal, setBusyLocal] = useState<number | "save" | null>(null);
  const [dropTarget, setDropTarget] = useState<GitStashEntry | null>(null);
  const requestRef = useRef(0);

  const loadStashes = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setStashes([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitStashList(repoRoot);
      if (id !== requestRef.current) return;
      setStashes(result);
    } catch (e) {
      if (id !== requestRef.current) return;
      setError(String(e));
      setStashes([]);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    if (open) void loadStashes();
  }, [open, loadStashes]);

  const handleSave = useCallback(async () => {
    if (!repoRoot || busyLocal !== null) return;
    setBusyLocal("save");
    try {
      await native.gitStashSave(repoRoot, null, true);
      await loadStashes();
      onRefresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyLocal(null);
    }
  }, [busyLocal, loadStashes, onRefresh, repoRoot]);

  const handleRestore = useCallback(
    async (entry: GitStashEntry) => {
      if (!repoRoot || busyLocal !== null) return;
      setBusyLocal(entry.index);
      try {
        const result = await native.gitStashApply(repoRoot, entry.sha, true);
        await loadStashes();
        onRefresh();
        if (result.hadConflicts) {
          onConflicts(
            `Conflicts restoring stash "${entry.message}"`,
            result.conflictedFiles,
          );
        } else if (result.applied) {
          toast.success(`Restored "${entry.message}".`);
        }
      } catch (e) {
        toast.error(String(e));
      } finally {
        setBusyLocal(null);
      }
    },
    [busyLocal, loadStashes, onConflicts, onRefresh, repoRoot],
  );

  const confirmDrop = useCallback(async () => {
    if (!repoRoot || !dropTarget) return;
    const target = dropTarget;
    setDropTarget(null);
    setBusyLocal(target.index);
    try {
      await native.gitStashDrop(repoRoot, target.sha);
      await loadStashes();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyLocal(null);
    }
  }, [dropTarget, loadStashes, repoRoot]);

  const disabled = busy || busyLocal !== null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {/* The click that opens the menu is handled by this trigger (via
              the span it clones its handlers onto); IconActionButton only
              supplies the tooltip + icon chrome, so its own onClick is a
              no-op. */}
          <span>
            <IconActionButton
              label="Stash"
              disabled={!repoRoot || busy}
              onClick={() => {}}
              side="bottom"
            >
              <HugeiconsIcon icon={Package01Icon} size={14} strokeWidth={1.8} />
            </IconActionButton>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            disabled={disabled || changedCount === 0}
            onSelect={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex cursor-pointer items-center gap-2 text-[12px] font-medium"
          >
            {busyLocal === "save" ? (
              <Spinner className="size-3.5 shrink-0" />
            ) : (
              <HugeiconsIcon
                icon={Package01Icon}
                size={13}
                strokeWidth={1.8}
                className="shrink-0"
              />
            )}
            Save current changes
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              Loading stashes…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
              {error}
            </div>
          ) : stashes.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">
              No stashed changes.
            </div>
          ) : (
            <DropdownMenuGroup>
              {stashes.map((entry) => (
                <div
                  key={entry.index}
                  className="flex items-center gap-0.5 px-1 py-0.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col px-1.5 py-1">
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {entry.message}
                    </span>
                    {entry.branch ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {entry.branch}
                      </span>
                    ) : null}
                  </div>
                  <IconActionButton
                    label="Restore stash"
                    disabled={disabled}
                    side="top"
                    onClick={() => {
                      setOpen(false);
                      void handleRestore(entry);
                    }}
                  >
                    {busyLocal === entry.index ? (
                      <Spinner className="size-3" />
                    ) : (
                      <HugeiconsIcon
                        icon={ArrowUp01Icon}
                        size={12}
                        strokeWidth={2}
                      />
                    )}
                  </IconActionButton>
                  <IconActionButton
                    label="Drop stash"
                    disabled={disabled}
                    side="top"
                    onClick={() => {
                      setOpen(false);
                      setDropTarget(entry);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={12}
                      strokeWidth={1.9}
                    />
                  </IconActionButton>
                </div>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop stash?</AlertDialogTitle>
            <AlertDialogDescription>
              {dropTarget
                ? `Drop "${dropTarget.message}"? This cannot be undone.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDropTarget(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDrop()}
            >
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConflictListDialog({
  notice,
  onDismiss,
}: {
  notice: { title: string; files: string[] } | null;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{notice?.title ?? "Conflicts"}</DialogTitle>
          <DialogDescription>
            Resolve these files, then stage and commit to finish. They stay
            visible in Changes until resolved.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border/60">
          {notice?.files.map((path) => (
            <div
              key={path}
              className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[12px] last:border-b-0"
            >
              <HugeiconsIcon
                icon={Alert02Icon}
                size={12}
                strokeWidth={1.9}
                className="shrink-0 text-destructive"
              />
              <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onDismiss}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoteActionControl({
  status,
  isDiverged,
  busy,
  onRun,
}: {
  status: { upstream: string | null; ahead: number; behind: number } | null;
  isDiverged: boolean;
  busy: SourceControlRemoteAction | null;
  onRun: (action: SourceControlRemoteAction) => void;
}) {
  const hasUpstream = !!status?.upstream;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const primary: SourceControlRemoteAction =
    behind > 0 ? "pull" : ahead > 0 ? "push" : "fetch";

  const disabledFor = useCallback(
    (action: SourceControlRemoteAction) => {
      if (!hasUpstream || busy !== null) return true;
      if (action === "pull") return behind === 0 || isDiverged;
      if (action === "push") return ahead === 0 || behind > 0;
      return false;
    },
    [ahead, behind, busy, hasUpstream, isDiverged],
  );

  const primaryTooltip = !hasUpstream
    ? "No upstream configured"
    : isDiverged
      ? "Branch diverged — resolve in terminal"
      : primary === "pull"
        ? `Pull ${behind} commits (fast-forward)`
        : primary === "push"
          ? ahead > 0
            ? `Push ${ahead} commits`
            : "No local commits to push"
          : "Fetch remote updates";

  const primaryBusy = busy === primary;
  const primaryDisabled = disabledFor(primary);

  return (
    <div className="flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            variant="secondary"
            disabled={primaryDisabled}
            onClick={() => onRun(primary)}
            className="h-6 cursor-pointer rounded-r-none text-[11px] font-medium disabled:cursor-not-allowed"
          >
            {primaryBusy ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon
                icon={
                  primary === "fetch"
                    ? FolderCloudIcon
                    : primary === "pull"
                      ? Download01Icon
                      : ArrowUp01Icon
                }
                size={12}
                strokeWidth={1.9}
              />
            )}
            {REMOTE_ACTION_LABELS[primary]}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
        >
          {primaryTooltip}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="secondary"
            disabled={busy !== null}
            aria-label="Other remote actions"
            className="h-6 w-4.5 cursor-pointer rounded-l-none border-l border-border/50 p-0 disabled:cursor-not-allowed"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {(["fetch", "pull", "push"] as const)
            .filter((action) => action !== primary)
            .map((action) => (
              <DropdownMenuItem
                key={action}
                disabled={disabledFor(action)}
                onSelect={() => onRun(action)}
                className="text-[12px]"
              >
                {REMOTE_ACTION_LABELS[action]}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  sourceControl,
  onOpenGitGraph,
  onOpenDiff,
  onOpenFile,
  onNavigateToPath,
}: Props) {
  const scm = useSourceControlPanel(open, sourceControl, onOpenDiff);
  const refreshAnimationRef = useRef<number | null>(null);
  const [refreshAnimating, setRefreshAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<{
    title: string;
    files: string[];
  } | null>(null);
  const handleConflicts = useCallback((title: string, files: string[]) => {
    setConflictNotice({ title, files });
  }, []);

  useEffect(() => {
    return () => {
      if (refreshAnimationRef.current) {
        window.clearTimeout(refreshAnimationRef.current);
      }
    };
  }, []);

  const isRefreshing = scm.panelState === "loading";
  const repoLabel = useMemo(() => {
    if (!scm.status) return "Source Control";
    return scm.status.isDetached ? "detached" : scm.status.branch;
  }, [scm.status]);

  const commitShortcut = IS_MAC ? "⌘↩" : "Ctrl+Enter";
  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    !scm.actionBusy;
  const commitDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : scm.stagedEntries.length === 0
      ? "Stage changes to enable commit."
      : scm.commitMessage.trim().length === 0
        ? "Enter a commit message to enable commit."
        : null;
  const commitHint = canCommit
    ? `Commit with ${commitShortcut}.`
    : (commitDisabledReason ?? `Commit with ${commitShortcut}.`);
  const stagedCount = scm.stagedEntries.length;
  const changedCount = scm.fileEntries.length;
  const pushStatusLabel = upstreamBadgeLabel(scm.status?.upstream);
  const isDiverged =
    !!scm.status && scm.status.ahead > 0 && scm.status.behind > 0;

  const footerFeedback = useMemo(() => {
    if (scm.actionError)
      return { tone: "error", message: scm.actionError } as const;
    if (scm.remoteError)
      return { tone: "error", message: scm.remoteError } as const;
    if (scm.actionMessage)
      return { tone: "success", message: scm.actionMessage } as const;
    return null;
  }, [scm.actionError, scm.actionMessage, scm.remoteError]);

  const handleCommitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      canCommit
    ) {
      event.preventDefault();
      void scm.commit();
      return;
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshAnimating(true);
    if (refreshAnimationRef.current) {
      window.clearTimeout(refreshAnimationRef.current);
    }
    void scm.refresh().finally(() => {
      refreshAnimationRef.current = window.setTimeout(() => {
        setRefreshAnimating(false);
        refreshAnimationRef.current = null;
      }, 450);
    });
  }, [scm]);

  const rows = useMemo<RowDescriptor[]>(() => {
    const result: RowDescriptor[] = [];
    if (isDiverged) {
      result.push({ kind: "banner-diverged", key: "banner-diverged" });
    }
    if (changedCount > 0) {
      result.push({
        kind: "list-header",
        key: "list-header",
        count: changedCount,
      });
      for (const entry of scm.fileEntries) {
        result.push({ kind: "entry", key: entry.key, entry });
      }
    }
    return result;
  }, [changedCount, isDiverged, scm.fileEntries]);

  const rowKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.key, index));
    return map;
  }, [rows]);

  useEffect(() => {
    if (!focusedRowKey) return;
    if (!rowKeyToIndex.has(focusedRowKey)) {
      setFocusedRowKey(null);
    }
  }, [focusedRowKey, rowKeyToIndex]);

  const focusableIndices = useMemo(() => {
    const out: number[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "entry") out.push(index);
    });
    return out;
  }, [rows]);

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return ROW_HEIGHTS.entry;
      switch (row.kind) {
        case "banner-diverged":
          return ROW_HEIGHTS.banner;
        case "list-header":
          return ROW_HEIGHTS.header;
        case "entry":
          return ROW_HEIGHTS.entry;
      }
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const currentIndex =
        focusedRowKey === null ? -1 : (rowKeyToIndex.get(focusedRowKey) ?? -1);
      let pos = focusableIndices.findIndex((i) => i === currentIndex);
      if (pos === -1) pos = direction > 0 ? -1 : focusableIndices.length;
      let nextPos = pos + direction;
      if (nextPos < 0) nextPos = 0;
      if (nextPos > focusableIndices.length - 1)
        nextPos = focusableIndices.length - 1;
      const targetRowIndex = focusableIndices[nextPos];
      const target = rows[targetRowIndex];
      if (!target) return;
      setFocusedRowKey(target.key);
      virtualizer.scrollToIndex(targetRowIndex, { align: "auto" });
    },
    [focusableIndices, focusedRowKey, rowKeyToIndex, rows, virtualizer],
  );

  const focusedEntry = useCallback((): SourceControlFileEntry | null => {
    if (!focusedRowKey) return null;
    const index = rowKeyToIndex.get(focusedRowKey);
    if (index === undefined) return null;
    const row = rows[index];
    return row && row.kind === "entry" ? row.entry : null;
  }, [focusedRowKey, rowKeyToIndex, rows]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.closest("button"))
      ) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        handleRefresh();
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1);
          break;
        case "Enter": {
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.selectFile(entry);
          }
          break;
        }
        case " ":
        case "s":
        case "S": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.toggleStageFile(entry);
          }
          break;
        }
        case "d":
        case "D": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry && entry.unstaged) {
            event.preventDefault();
            scm.requestDiscardFile(entry);
          }
          break;
        }
      }
    },
    [focusedEntry, handleRefresh, moveFocus, scm],
  );

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <aside className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <BranchDropdown
              repoRoot={scm.repo?.repoRoot ?? null}
              repoLabel={repoLabel}
              currentBranch={scm.status?.branch ?? null}
              changedCount={changedCount}
              busy={!!scm.actionBusy}
              onNavigateToPath={onNavigateToPath}
              onRefresh={handleRefresh}
              onConflicts={handleConflicts}
            />
            {scm.status && (scm.status.ahead > 0 || scm.status.behind > 0) ? (
              <div className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground">
                {scm.status.ahead > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.ahead}
                  </span>
                ) : null}
                {scm.status.behind > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.behind}
                  </span>
                ) : null}
              </div>
            ) : null}
            {scm.status?.isDetached ? (
              <span className="rounded bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                detached
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RemoteActionControl
              status={scm.status}
              isDiverged={isDiverged}
              busy={sourceControl.busyAction}
              onRun={(action) => void scm.runRemote(action)}
            />
            <StashMenu
              repoRoot={scm.repo?.repoRoot ?? null}
              changedCount={changedCount}
              busy={!!scm.actionBusy}
              onRefresh={handleRefresh}
              onConflicts={handleConflicts}
            />
            <IconActionButton
              label="Refresh source control"
              disabled={isRefreshing || !!scm.actionBusy}
              onClick={handleRefresh}
              side="bottom"
            >
              {isRefreshing ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={14}
                  strokeWidth={1.9}
                  className={cn(refreshAnimating && "animate-spin")}
                />
              )}
            </IconActionButton>
          </div>
        </header>

        {onOpenGitGraph ? (
          <button
            type="button"
            onClick={() => onOpenGitGraph()}
            className="group flex shrink-0 cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={13}
              strokeWidth={1.85}
              className="shrink-0"
            />
            <span className="flex-1 text-[12px] font-medium">Commit Graph</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        ) : null}

        {scm.panelState === "loading" ? (
          <PanelCenter title="Loading repository" />
        ) : null}

        {scm.panelState === "no-repo" ? (
          <PanelCenter
            title="No repository"
            body="The active workspace is not inside a Git repository."
          />
        ) : null}

        {scm.panelState === "error" ? (
          <PanelCenter
            title="Source control error"
            body={scm.statusError ?? "Unknown source control error"}
            action={
              <Button size="sm" onClick={() => void scm.refresh()}>
                Retry
              </Button>
            }
          />
        ) : null}

        {scm.panelState === "ready" && scm.status ? (
          <>
            <div className="relative shrink-0 space-y-2 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 pb-2.5 pt-2.5">
              <div
                className={cn(
                  "relative rounded-lg border bg-background/95 shadow-sm transition-colors",
                  scm.commitMessage.length > 0
                    ? "border-border/70"
                    : "border-border/45",
                  "focus-within:border-primary/45 focus-within:shadow-md focus-within:shadow-primary/5",
                )}
              >
                <Textarea
                  value={scm.commitMessage}
                  onChange={(event) => scm.setCommitMessage(event.target.value)}
                  onKeyDown={handleCommitShortcut}
                  placeholder="Commit message"
                  rows={3}
                  className={cn(
                    "min-h-[72px] border-border resize-none rounded-lg bg-transparent px-3 pb-7 pt-2.5 text-[12.5px] leading-snug shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 focus:border-0",
                  )}
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex items-center justify-between p-1 gap-2 text-[10px] tabular-nums text-muted-foreground/55">
                  {scm.commitMessage.length > 0 ? (
                    <span>Ch: {scm.commitMessage.length}</span>
                  ) : (
                    <span className="flex gap-2 items-center">
                      {commitShortcut} <p>to commit</p>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-colors",
                    canCommit
                      ? "bg-foreground/80"
                      : stagedCount > 0
                        ? "bg-muted-foreground/60"
                        : "bg-muted-foreground/30",
                  )}
                />
                <span className="truncate font-medium text-foreground/85">
                  {stagedCount === 0
                    ? "Nothing staged"
                    : `${stagedCount} ${stagedCount === 1 ? "file" : "files"} staged`}
                </span>
                <span className="ml-auto shrink-0 truncate text-muted-foreground/65">
                  {pushStatusLabel}
                </span>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="xs"
                    className="h-7 w-full cursor-pointer text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
                    disabled={!canCommit}
                    onClick={() => void scm.commit()}
                  >
                    {scm.actionBusy === "commit" ? "Committing…" : "Commit"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
                >
                  {commitHint}
                </TooltipContent>
              </Tooltip>

              <CommitFeedback feedback={footerFeedback} />
            </div>

            {scm.allClean ? (
              <CleanTreeHint repoLabel={repoLabel} />
            ) : (
              <div
                ref={containerRef}
                tabIndex={0}
                role="listbox"
                aria-label="Changed files"
                aria-activedescendant={
                  focusedRowKey ? `scm-row-${focusedRowKey}` : undefined
                }
                onKeyDown={handlePanelKeyDown}
                className="relative min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
              >
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                >
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <RowRenderer
                            row={row}
                            focused={focusedRowKey === row.key}
                            selectedPath={scm.selected?.path ?? null}
                            actionBusy={scm.actionBusy}
                            headerCheckState={scm.headerCheckState}
                            repoRoot={scm.repo?.repoRoot ?? null}
                            onFocusRow={setFocusedRowKey}
                            onToggleAll={scm.toggleAll}
                            onSelectFile={scm.selectFile}
                            onToggleStageFile={scm.toggleStageFile}
                            onDiscardFile={scm.requestDiscardFile}
                            onOpenFile={onOpenFile}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <StatusBar
              status={scm.status}
              conflictedCount={scm.conflictedCount}
              lastOperation={scm.lastOperation}
            />
          </>
        ) : null}
      </aside>

      <ConflictListDialog
        notice={conflictNotice}
        onDismiss={() => setConflictNotice(null)}
      />

      <AlertDialog
        open={scm.pendingDiscard !== null}
        onOpenChange={(o) => {
          if (!o) scm.cancelPendingDiscard();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {scm.pendingDiscard?.scope === "all"
                ? `This will discard ${scm.pendingDiscard.label} and cannot be undone.`
                : scm.pendingDiscard
                  ? `Discard changes in "${scm.pendingDiscard.label}"? This cannot be undone.`
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => scm.cancelPendingDiscard()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void scm.confirmPendingDiscard()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
});

function PanelCenter({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      {body ? (
        <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
          {body}
        </div>
      ) : null}
      {action}
    </div>
  );
}

function CleanTreeHint({ repoLabel }: { repoLabel: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          size={16}
          strokeWidth={1.6}
        />
      </div>
      <div className="text-[12px] font-medium text-foreground">
        Working tree clean
      </div>
      <div className="text-[10.5px] leading-snug text-muted-foreground">
        on <span className="font-mono text-foreground/80">{repoLabel}</span>
      </div>
    </div>
  );
}

function StatusBar({
  status,
  conflictedCount,
  lastOperation,
}: {
  status: GitStatusSnapshot;
  conflictedCount: number;
  lastOperation: SourceControlLastOperation | null;
}) {
  // Re-render periodically so "just now" ages into "2m ago" etc.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!lastOperation) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [lastOperation]);

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-border/40 bg-card/60 px-3 py-1.5 text-[10.5px] text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1">
        <HugeiconsIcon icon={GitBranchIcon} size={10} strokeWidth={1.9} />
        <span className="font-medium text-foreground/85">
          {status.isDetached ? "detached" : status.branch}
        </span>
      </span>
      <span className="shrink-0 tabular-nums">
        {status.ahead > 0 || status.behind > 0
          ? `↑${status.ahead} ↓${status.behind}`
          : "up to date"}
      </span>
      <span
        className={cn(
          "shrink-0",
          conflictedCount > 0 && "font-medium text-destructive",
        )}
      >
        {conflictedCount} {conflictedCount === 1 ? "conflict" : "conflicts"}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {status.upstream ? `upstream ${status.upstream}` : "no upstream"}
      </span>
      {lastOperation ? (
        <span
          className={cn("shrink-0", !lastOperation.ok && "text-destructive")}
        >
          {lastOperation.label} {relativeTime(lastOperation.at)}
        </span>
      ) : null}
    </div>
  );
}

type RowRendererProps = {
  row: RowDescriptor;
  focused: boolean;
  selectedPath: string | null;
  actionBusy: string | null;
  headerCheckState: CheckState;
  repoRoot: string | null;
  onFocusRow: (key: string | null) => void;
  onToggleAll: () => Promise<void> | void;
  onSelectFile: (entry: SourceControlFileEntry) => Promise<void>;
  onToggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  onDiscardFile: (entry: SourceControlFileEntry) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const RowRenderer = memo(function RowRenderer(props: RowRendererProps) {
  const { row } = props;
  switch (row.kind) {
    case "banner-diverged":
      return <DivergedBanner />;
    case "list-header":
      return <ListHeader {...props} row={row} />;
    case "entry":
      return <EntryRow {...props} row={row} />;
  }
});

function DivergedBanner() {
  return (
    <div className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.04] px-2 text-[10.5px] leading-none text-muted-foreground">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={11}
        strokeWidth={1.9}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/85">
          Diverged from upstream
        </span>
        <span className="ml-1 opacity-75">— resolve in terminal</span>
      </span>
    </div>
  );
}

function ListHeader({
  row,
  actionBusy,
  headerCheckState,
  onToggleAll,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "list-header" }>;
}) {
  return (
    <div className="flex h-7 items-center gap-2 px-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        Changes
      </span>
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
        {row.count}
      </span>
      <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground">
        <span>All</span>
        <Checkbox
          aria-label="Stage all changes"
          checked={checkboxValue(headerCheckState)}
          disabled={actionBusy !== null}
          onCheckedChange={() => void onToggleAll()}
          className="size-3.5"
        />
      </label>
    </div>
  );
}

const EntryRow = memo(function EntryRow({
  row,
  focused,
  selectedPath,
  actionBusy,
  repoRoot,
  onFocusRow,
  onSelectFile,
  onToggleStageFile,
  onDiscardFile,
  onOpenFile,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "entry" }>;
}) {
  const entry = row.entry;
  const isSelected = selectedPath === entry.path;
  const fileName = basename(entry.path);
  const iconUrl = fileIconUrl(fileName);
  const pathLabel = entryPathLabel(entry);
  const showDiscard = entry.unstaged;
  const isStageBusy =
    actionBusy === `stage:${entry.path}` ||
    actionBusy === `unstage:${entry.path}`;
  const isDiscardBusy = actionBusy === `discard:${entry.path}`;
  const disabled = actionBusy !== null;

  const absolutePath = repoRoot
    ? joinPath(repoRoot.replace(/\\/g, "/"), entry.path.replace(/\\/g, "/"))
    : null;
  const isDeleted = entry.statusCode === "D";
  const revealLabel = IS_MAC ? "Reveal in Finder" : "Reveal in File Manager";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`scm-row-${row.key}`}
          data-focused={focused || undefined}
          data-selected={isSelected || undefined}
          role="option"
          aria-selected={isSelected}
          onMouseDown={() => onFocusRow(row.key)}
          className={cn(
            "group relative flex h-[30px] items-center gap-2 rounded-md pl-2 pr-2 transition-all duration-100",
            focused
              ? "bg-accent/60"
              : isSelected
                ? "bg-accent/55 text-foreground"
                : "hover:bg-accent/30",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full transition-opacity",
              statusAccent(entry.statusCode),
              isSelected || focused
                ? "opacity-100"
                : "opacity-55 group-hover:opacity-95",
            )}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => {
              onFocusRow(row.key);
              void onSelectFile(entry);
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
              <span
                className={cn(
                  "truncate text-[12px] leading-tight",
                  isSelected || focused
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground/95",
                  pathLabel ? "max-w-[58%] shrink-0" : "min-w-0 flex-1",
                )}
              >
                {fileName}
              </span>
              {pathLabel ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-tight text-muted-foreground/75">
                  {pathLabel}
                </span>
              ) : null}
            </div>
          </button>

          {showDiscard ? (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 data-[focused=true]:opacity-100 data-[selected=true]:opacity-100">
              <IconActionButton
                label={`Discard ${entry.path}`}
                disabled={disabled}
                side="top"
                onClick={() => onDiscardFile(entry)}
              >
                {isDiscardBusy ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={RemoveSquareIcon}
                    size={11}
                    strokeWidth={1.9}
                  />
                )}
              </IconActionButton>
            </div>
          ) : null}

          <span className="flex size-5 shrink-0 items-center justify-center">
            {isStageBusy ? (
              <Spinner className="size-3" />
            ) : (
              <Checkbox
                aria-label={`Stage ${entry.path}`}
                checked={checkboxValue(entry.checkState)}
                disabled={disabled}
                onCheckedChange={() => void onToggleStageFile(entry)}
                className="size-3.5"
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className={COMPACT_CONTENT}>
        {/* Open actions */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => {
            onFocusRow(row.key);
            void onSelectFile(entry);
          }}
        >
          Open Diff
        </ContextMenuItem>
        {!isDeleted && onOpenFile && absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(absolutePath)}
          >
            Open File
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Stage / Unstage */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          disabled={disabled}
          onSelect={() => void onToggleStageFile(entry)}
        >
          {entry.checkState === "checked" ? "Unstage" : "Stage"}
        </ContextMenuItem>
        {entry.unstaged ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            variant="destructive"
            disabled={disabled}
            onSelect={() => onDiscardFile(entry)}
          >
            Discard Changes
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Copy paths */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(entry.path.replace(/\\/g, "/"))}
        >
          Copy Relative Path
        </ContextMenuItem>
        {absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(absolutePath)}
          >
            Copy Absolute Path
          </ContextMenuItem>
        ) : null}

        {/* Reveal in Finder — only for existing files */}
        {!isDeleted && absolutePath ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void revealInFinder(absolutePath)}
            >
              {revealLabel}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function IconActionButton({
  label,
  disabled,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  side?: "left" | "top" | "right" | "bottom";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-6 p-3 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CommitFeedback({
  feedback,
}: {
  feedback: { tone: "error" | "success"; message: string } | null;
}) {
  const [visibleFeedback, setVisibleFeedback] = useState(feedback);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!feedback) {
      setIsVisible(false);
      return;
    }
    setVisibleFeedback(feedback);
    setIsVisible(true);
    // Auth failures carry a "next action" hint worth reading — keep them
    // visible longer than a routine success/error blip.
    const auth = feedback.tone === "error" && isAuthError(feedback.message);
    const hideDelay = auth ? 8000 : 3600;
    const clearDelay = auth ? 8300 : 3900;
    const hideTimer = window.setTimeout(() => setIsVisible(false), hideDelay);
    const clearTimer = window.setTimeout(() => {
      setVisibleFeedback((current) =>
        current?.message === feedback.message && current.tone === feedback.tone
          ? null
          : current,
      );
    }, clearDelay);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [feedback]);

  if (!visibleFeedback) return null;

  const isError = visibleFeedback.tone === "error";
  const isAuth = isError && isAuthError(visibleFeedback.message);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-[calc(100%-0.25rem)] z-20 flex min-w-0 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/15 backdrop-blur transition-all duration-200",
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
        isError
          ? "border-destructive/30 bg-card/95 text-destructive"
          : "border-border/70 bg-card/95 text-muted-foreground",
      )}
    >
      {isAuth ? (
        <HugeiconsIcon
          icon={Alert02Icon}
          size={12}
          strokeWidth={2}
          className="mt-0.5 shrink-0"
        />
      ) : (
        <span
          className={cn(
            "mt-1 size-1.5 shrink-0 rounded-full",
            isError ? "bg-destructive" : "bg-foreground/70",
          )}
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1",
          isAuth ? "line-clamp-3" : "truncate",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {isAuth ? (
          <b className="font-semibold">Authentication required — </b>
        ) : null}
        {visibleFeedback.message}
      </span>
    </div>
  );
}
