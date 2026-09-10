import { afterEach, expect, it, vi } from "vitest";
import {
  PROJECT_PANEL,
  readPanelState,
  rememberPanelWidth,
} from "./panelState";

afterEach(() => vi.unstubAllGlobals());

it("keeps project width and collapse state independent from the original sidebar", () => {
  const saved = new Map([
    ["pide.sidebar.width", "450"],
    ["pide.sidebar.collapsed", "1"],
    ["pide.projects.width", "210"],
    ["pide.projects.collapsed", "0"],
  ]);
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => saved.get(key) ?? null },
  });
  expect(readPanelState(PROJECT_PANEL)).toEqual({
    width: 210,
    collapsed: false,
  });
});
it("clamps stale widths and restores collapsed projects", () => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key.endsWith("width") ? "900" : "1"),
    },
  });
  expect(readPanelState(PROJECT_PANEL)).toEqual({
    width: 400,
    collapsed: true,
  });
});
it("falls back safely when storage is unavailable", () => {
  vi.stubGlobal("window", {
    get localStorage() {
      throw new Error("unavailable");
    },
  });
  expect(readPanelState(PROJECT_PANEL)).toEqual({
    width: 224,
    collapsed: false,
  });
});

it("preserves the last expanded width across collapse and expansion animation frames", () => {
  let width = rememberPanelWidth(224, 336, PROJECT_PANEL, false);
  for (const measured of [310, 250, 180, 80, 1, 0, 1, 80, 180, 260, 336]) {
    width = rememberPanelWidth(width, measured, PROJECT_PANEL, true);
    expect(width).toBe(336);
  }
  expect(rememberPanelWidth(width, 290, PROJECT_PANEL, false)).toBe(290);
});
