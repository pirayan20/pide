import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";

export type CloseBlocker = {
  dirtyEditors: number;
  busyTerminal: boolean;
};

export async function inspectCloseBlockers(tabs: Tab[]): Promise<CloseBlocker> {
  const leaves = tabs.flatMap((tab) =>
    tab.kind === "terminal" ? leafIds(tab.paneTree) : [],
  );
  const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
  return {
    dirtyEditors: tabs.filter((tab) => tab.kind === "editor" && tab.dirty)
      .length,
    busyTerminal: checks.some(Boolean),
  };
}

export function hasCloseBlocker(blocker: CloseBlocker): boolean {
  return blocker.dirtyEditors > 0 || blocker.busyTerminal;
}
