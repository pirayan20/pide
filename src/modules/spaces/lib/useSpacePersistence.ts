import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import { isSerializableTab, serializeTabs } from "./serialize";
import { saveProjectState } from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 3000;

type Snapshot = {
  tabs: Tab[];
  activeId: number | null;
  activeProjectId: string | null;
};

type Params = Snapshot & {
  enabled: boolean;
};

type LastWrite = { json: string; activeTabIndex: number | null };

export function useSpacePersistence({
  tabs,
  activeId,
  activeProjectId,
  enabled,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot>({ tabs, activeId, activeProjectId });
  latest.current = { tabs, activeId, activeProjectId };

  if (enabled && !seeded.current) {
    seeded.current = true;
    for (const [id, index] of Object.entries(
      useSpaces.getState().initialActiveIndex,
    )) {
      last.current.set(id, { json: "", activeTabIndex: index });
    }
  }

  const flush = useCallback((snapshot: Snapshot) => {
    for (const project of useSpaces.getState().projects) {
      const group = snapshot.tabs.filter(
        (tab) => tab.projectId === project.id,
      );
      const serialized = serializeTabs(group);
      const previous = last.current.get(project.id);
      let activeTabIndex = previous?.activeTabIndex ?? null;
      if (group.length === 0) {
        activeTabIndex = null;
      } else if (project.id === snapshot.activeProjectId) {
        const index = group
          .filter(isSerializableTab)
          .findIndex((tab) => tab.id === snapshot.activeId);
        activeTabIndex = index >= 0 ? index : null;
      }
      const json = JSON.stringify(serialized);
      if (
        previous?.json === json &&
        previous.activeTabIndex === activeTabIndex
      ) {
        continue;
      }
      last.current.set(project.id, { json, activeTabIndex });
      void saveProjectState(project.id, { tabs: serialized, activeTabIndex });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const snapshot = { tabs, activeId, activeProjectId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush(snapshot);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, activeProjectId, enabled, flush]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush(latest.current);
    };
    const onLeave = () => flush(latest.current);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      flush(latest.current);
    };
  }, [enabled, flush]);
}
