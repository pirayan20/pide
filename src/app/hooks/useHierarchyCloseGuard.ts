import { useCallback, useRef, useState } from "react";
import type { Tab } from "@/modules/tabs";
import {
  hasCloseBlocker,
  inspectCloseBlockers,
  type CloseBlocker,
} from "./closeBlockers";

export type HierarchyCloseRequest = {
  kind: "project" | "space";
  id: string;
  name: string;
  tabIds: number[];
  blocker: CloseBlocker;
};

type RequestInput = Omit<HierarchyCloseRequest, "blocker">;
type Confirmed = () => void | Promise<void>;

export function useHierarchyCloseGuard(tabs: Tab[]) {
  const [pendingHierarchyClose, setPendingHierarchyClose] =
    useState<HierarchyCloseRequest | null>(null);
  const confirmed = useRef<Confirmed | null>(null);

  const requestHierarchyClose = useCallback(
    async (request: RequestInput, onConfirmed: Confirmed) => {
      const ids = new Set(request.tabIds);
      const blocker = await inspectCloseBlockers(
        tabs.filter((tab) => ids.has(tab.id)),
      );
      if (!hasCloseBlocker(blocker)) {
        await onConfirmed();
        return;
      }
      confirmed.current = onConfirmed;
      setPendingHierarchyClose({ ...request, blocker });
    },
    [tabs],
  );

  const confirmHierarchyClose = useCallback(async () => {
    const callback = confirmed.current;
    confirmed.current = null;
    setPendingHierarchyClose(null);
    if (callback) await callback();
  }, []);

  const cancelHierarchyClose = useCallback(() => {
    confirmed.current = null;
    setPendingHierarchyClose(null);
  }, []);

  return {
    pendingHierarchyClose,
    requestHierarchyClose,
    confirmHierarchyClose,
    cancelHierarchyClose,
  };
}
