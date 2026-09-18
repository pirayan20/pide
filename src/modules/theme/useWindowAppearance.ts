import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  createBlurController,
  resolveWindowAppearance,
} from "@/modules/theme/windowAppearance";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect } from "react";
import { create } from "zustand";

export const useWindowAppearanceStatus = create<{ error: string | null }>(
  () => ({
    error: null,
  }),
);

const syncBlur = createBlurController(async (enabled) => {
  if (!IS_MAC && !IS_WINDOWS) return;
  await invoke("set_window_blur", { enabled });
});

export function useWindowAppearance(): void {
  const opacity = usePreferencesStore((s) => s.windowOpacity);
  const blur = usePreferencesStore((s) => s.windowBlur);
  const appearance = resolveWindowAppearance(opacity, blur);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--window-opacity", `${appearance.opacity * 100}%`);
    root.dataset.windowTransparent = String(appearance.transparent);
  }, [appearance.opacity, appearance.transparent]);

  useEffect(() => {
    let current = true;
    useWindowAppearanceStatus.setState({ error: null });
    void syncBlur(appearance.blur).catch((error) => {
      console.error("Window blur failed:", error);
      if (current) {
        useWindowAppearanceStatus.setState({
          error: "Could not change background blur. Try toggling it again.",
        });
      }
    });
    return () => {
      current = false;
    };
  }, [appearance.blur]);
}
