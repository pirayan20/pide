import {
  animateSidebarLayout,
  isSidebarAnimating,
} from "@/modules/sidebar/animateSidebarLayout";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  rememberPanelWidth,
  readPanelState,
  type PanelSettings,
} from "@/modules/sidebar/panelState";

export function useResizableSidebar(settings: PanelSettings) {
  const [initial] = useState(() => readPanelState(settings));
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const widthRef = useRef(initial.width);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedRef = useRef(initial.collapsed);
  const persistWidth = useCallback(() => {
    try {
      window.localStorage.setItem(
        `${settings.key}.width`,
        String(widthRef.current),
      );
    } catch {}
  }, [settings]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        persistWidth();
      }
    },
    [persistWidth],
  );

  const onResize = useCallback(
    (size: { inPixels: number }) => {
      const nextCollapsed = size.inPixels <= 0;
      if (nextCollapsed !== collapsedRef.current) {
        collapsedRef.current = nextCollapsed;
        setCollapsed(nextCollapsed);
        try {
          window.localStorage.setItem(
            `${settings.key}.collapsed`,
            nextCollapsed ? "1" : "0",
          );
        } catch {}
      }
      const nextWidth = rememberPanelWidth(
        widthRef.current,
        size.inPixels,
        settings,
        isSidebarAnimating("projects"),
      );
      if (nextWidth !== widthRef.current) {
        widthRef.current = nextWidth;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          persistWidth();
        }, 200);
      }
    },
    [settings, persistWidth],
  );

  const expand = useCallback(() => {
    animateSidebarLayout("projects", () =>
      panelRef.current?.resize(`${widthRef.current}px`),
    );
  }, []);
  const toggle = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) expand();
    else animateSidebarLayout("projects", () => panel.collapse());
  }, [expand]);

  return { panelRef, initial, collapsed, onResize, toggle, expand };
}
