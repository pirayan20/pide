import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Tab } from "@/modules/tabs";
import {
  hasCloseBlocker,
  inspectCloseBlockers,
  type CloseBlocker,
} from "./closeBlockers";

export function useAppCloseGuard(tabsRef: RefObject<Tab[]>) {
  const [pendingAppClose, setPendingAppClose] = useState<CloseBlocker | null>(
    null,
  );
  const forceClose = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        const blocker = await inspectCloseBlockers(tabsRef.current);
        if (hasCloseBlocker(blocker)) {
          setPendingAppClose(blocker);
        } else {
          forceClose.current = true;
          void getCurrentWindow().close();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabsRef]);

  const confirmAppClose = useCallback(() => {
    setPendingAppClose(null);
    forceClose.current = true;
    void getCurrentWindow().close();
  }, []);

  const cancelAppClose = useCallback(() => setPendingAppClose(null), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
