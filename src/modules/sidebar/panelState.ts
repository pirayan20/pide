export type PanelSettings = {
  key: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

export const PROJECT_PANEL: PanelSettings = {
  key: "pide.projects",
  defaultWidth: 224,
  minWidth: 180,
  maxWidth: 400,
};

export function clampPanelWidth(
  width: number,
  settings: PanelSettings,
): number {
  return Number.isFinite(width)
    ? Math.min(
        settings.maxWidth,
        Math.max(settings.minWidth, Math.round(width)),
      )
    : settings.defaultWidth;
}

export function readPanelState(settings: PanelSettings) {
  try {
    const value = window.localStorage.getItem(`${settings.key}.width`);
    return {
      width: clampPanelWidth(value ? Number(value) : NaN, settings),
      collapsed:
        window.localStorage.getItem(`${settings.key}.collapsed`) === "1",
    };
  } catch {
    return { width: settings.defaultWidth, collapsed: false };
  }
}

export function rememberPanelWidth(
  previous: number,
  measured: number,
  settings: PanelSettings,
  animating: boolean,
): number {
  return !animating && measured > 0 && Number.isFinite(measured)
    ? clampPanelWidth(measured, settings)
    : previous;
}
