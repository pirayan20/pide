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
import type { CloseBlocker } from "@/app/hooks/closeBlockers";
import type { HierarchyCloseRequest } from "@/app/hooks/useHierarchyCloseGuard";
import type { Tab } from "@/modules/tabs";

type Props = {
  tabs: Tab[];
  pendingCloseTab: number | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  pendingTerminalCloseTab: number | null;
  onCancelTerminalClose: () => void;
  onConfirmTerminalClose: () => void;
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
  pendingAppClose: CloseBlocker | null;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
  pendingHierarchyClose: HierarchyCloseRequest | null;
  onCancelHierarchyClose: () => void;
  onConfirmHierarchyClose: () => void;
};

function hierarchyCloseMessage(request: HierarchyCloseRequest): string {
  const impact =
    request.kind === "project"
      ? `Removing ${request.name} detaches the Project. Its folder and files will not be deleted.`
      : `Deleting ${request.name} detaches every Project in the Space. Their folders and files will not be deleted.`;
  const blockers = [
    request.blocker.dirtyEditors > 0
      ? `${request.blocker.dirtyEditors} unsaved ${request.blocker.dirtyEditors === 1 ? "file" : "files"}`
      : null,
    request.blocker.busyTerminal ? "a running terminal process" : null,
  ].filter(Boolean);
  return `${impact} Continuing will close ${blockers.join(" and ")}.`;
}

function appCloseMessage(blocker: CloseBlocker): string {
  const dirty =
    blocker.dirtyEditors === 1
      ? "1 file has unsaved changes"
      : `${blocker.dirtyEditors} files have unsaved changes`;
  if (blocker.dirtyEditors > 0 && blocker.busyTerminal) {
    return `A process is still running and ${dirty}. Quitting will terminate it and discard the changes.`;
  }
  if (blocker.dirtyEditors > 0) {
    return `${dirty.charAt(0).toUpperCase()}${dirty.slice(1)}. Quitting will discard them.`;
  }
  return "A process is still running in a terminal. Quitting will terminate it.";
}

/** Confirmation dialogs for closing dirty editors and terminals with live processes. */
export function CloseDialogs({
  tabs,
  pendingCloseTab,
  onCancelClose,
  onConfirmClose,
  pendingTerminalCloseTab,
  onCancelTerminalClose,
  onConfirmTerminalClose,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
  pendingHierarchyClose,
  onCancelHierarchyClose,
  onConfirmHierarchyClose,
}: Props) {
  return (
    <>
      <AlertDialog
        open={pendingCloseTab !== null}
        onOpenChange={(open) => !open && onCancelClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {tabs.find((t) => t.id === pendingCloseTab)?.title
                ? `"${
                    tabs.find((t) => t.id === pendingCloseTab)?.title
                  }" has unsaved changes. Close anyway?`
                : "This file has unsaved changes. Close anyway?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingTerminalCloseTab !== null}
        onOpenChange={(open) => !open && onCancelTerminalClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              A process is running. Closing this tab will terminate it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelTerminalClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmTerminalClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteTabs !== null}
        onOpenChange={(open) => !open && onCancelDeleteClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteTabs?.length === 1
                ? (() => {
                    const title = tabs.find(
                      (t) => t.id === pendingDeleteTabs[0],
                    )?.title;
                    return title
                      ? `"${title}" has unsaved changes. The file has been deleted. Close anyway?`
                      : "This file has unsaved changes. The file has been deleted. Close anyway?";
                  })()
                : `${pendingDeleteTabs?.length ?? 0} files have unsaved changes. They have been deleted. Close all anyway?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelDeleteClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingHierarchyClose !== null}
        onOpenChange={(open) => !open && onCancelHierarchyClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingHierarchyClose?.kind === "project"
                ? "Remove Project?"
                : "Delete Space?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingHierarchyClose
                ? hierarchyCloseMessage(pendingHierarchyClose)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelHierarchyClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmHierarchyClose()}>
              {pendingHierarchyClose?.kind === "project"
                ? "Remove Project"
                : "Delete Space"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAppClose !== null}
        onOpenChange={(open) => !open && onCancelAppClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quit Pide?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAppClose ? appCloseMessage(pendingAppClose) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelAppClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmAppClose}>
              Quit Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
