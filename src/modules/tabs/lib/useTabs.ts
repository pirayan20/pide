import { previewRendererFor, type RenderKind } from "@/lib/utils";
import { rebasePath } from "@/modules/spaces/lib/projectPaths";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  type PaneBounds,
  type PaneDirection,
  type PaneNode,
  removeLeaf,
  type SplitDir,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
  swapLeafInDirection,
} from "@/modules/terminal/lib/panes";
import { disposeSession } from "@/modules/terminal/lib/useTerminalSession";
import { useCallback, useEffect, useRef, useState } from "react";

// Matches the renderer slot pool size — over this we'd evict an active leaf.
export const MAX_PANES_PER_TAB = 4;

type TabBase = {
  projectId: string;
  /** Restored from disk, not yet activated: rendered as a placeholder, not mounted. */
  cold?: boolean;
};

export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  /** Ephemeral terminal omitted from workspace restoration. */
  private?: boolean;
  /** User-set label that overrides the cwd-derived name. Survives cd. */
  customTitle?: string;
};

export type EditorTab = TabBase & {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
  overrideLanguage?: string | null;
};

export type PreviewTab = TabBase & {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

export type RenderTab = TabBase & {
  id: number;
  kind: "render";
  title: string;
  path: string;
  renderer: RenderKind;
  overrideLanguage?: string | null;
};

/** Alias kept for external call sites; `RenderTab` is the canonical name. */
export type MarkdownTab = RenderTab;

export type GitDiffTab = TabBase & {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
};

export type GitHistoryTab = TabBase & {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
};

export type GitCommitFileDiffTab = TabBase & {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | RenderTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  /** Empty string resets a terminal tab to its cwd-derived name. */
  customTitle: string;
  overrideLanguage: string | null;
}>;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}

export function pickTabByProjectIndex(
  tabs: Tab[],
  index: number,
  projectId: string,
): Tab | undefined {
  return tabs.filter((tab) => tab.projectId === projectId)[index];
}

export function nextActiveInProject(
  tabs: Tab[],
  closingId: number,
): number | null {
  const closing = tabs.find((tab) => tab.id === closingId);
  if (!closing) return null;
  const siblings = tabs.filter((tab) => tab.projectId === closing.projectId);
  const index = siblings.findIndex((tab) => tab.id === closingId);
  return siblings[index - 1]?.id ?? siblings[index + 1]?.id ?? null;
}

export function reorderTabsByGap(
  tabs: Tab[],
  fromId: number,
  toGapIndex: number,
): Tab[] {
  const moved = tabs.find((tab) => tab.id === fromId);
  if (!moved) return tabs;
  const siblings = tabs.filter((tab) => tab.projectId === moved.projectId);
  const fromIndex = siblings.findIndex((tab) => tab.id === fromId);
  let targetIndex = toGapIndex > fromIndex ? toGapIndex - 1 : toGapIndex;
  targetIndex = Math.max(0, Math.min(targetIndex, siblings.length - 1));
  if (targetIndex === fromIndex) return tabs;
  const anchor = siblings[targetIndex];
  const next = tabs.filter((tab) => tab.id !== fromId);
  const anchorIndex = next.findIndex((tab) => tab.id === anchor.id);
  const insertIndex = targetIndex > fromIndex ? anchorIndex + 1 : anchorIndex;
  next.splice(insertIndex, 0, moved);
  return next;
}

export function planProjectTabsRemoval(
  tabs: Tab[],
  projectIds: string[],
  activeId: number | null,
): { tabs: Tab[]; disposeLeafIds: number[]; activeId: number | null } {
  const removed = new Set(projectIds);
  const removedTabs = tabs.filter((tab) => removed.has(tab.projectId));
  const next = tabs.filter((tab) => !removed.has(tab.projectId));
  return {
    tabs: next,
    disposeLeafIds: removedTabs.flatMap((tab) =>
      tab.kind === "terminal" ? leafIds(tab.paneTree) : [],
    ),
    activeId:
      activeId !== null && next.some((tab) => tab.id === activeId)
        ? activeId
        : null,
  };
}

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [booted, setBooted] = useState(false);
  const nextIdRef = useRef(1);
  const activeProjectIdRef = useRef<string | null>(null);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!booted || activeId === null) return;
    setTabs((current) => {
      const active = current.find((tab) => tab.id === activeId);
      if (!active?.cold) return current;
      return current.map((tab) =>
        tab.id === activeId ? { ...tab, cold: false } : tab,
      );
    });
  }, [activeId, booted]);

  const allocId = useCallback(() => nextIdRef.current++, []);
  const markBooted = useCallback(() => setBooted(true), []);

  const setActiveProjectForNewTabs = useCallback((projectId: string | null) => {
    activeProjectIdRef.current = projectId;
  }, []);

  const replaceTabs = useCallback(
    (next: Tab[], nextActiveId: number | null) => {
      tabsRef.current = next;
      activeIdRef.current = nextActiveId;
      setTabs(next);
      setActiveId(nextActiveId);
    },
    [],
  );

  const newTabInProject = useCallback((projectId: string, cwd: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((current) => [
      ...current,
      {
        id: tabId,
        kind: "terminal",
        projectId,
        cold: true,
        title: basename(cwd),
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ]);
    return tabId;
  }, []);

  const removeTabsForProjects = useCallback((projectIds: string[]) => {
    const plan = planProjectTabsRemoval(
      tabsRef.current,
      projectIds,
      activeIdRef.current,
    );
    tabsRef.current = plan.tabs;
    activeIdRef.current = plan.activeId;
    setTabs(plan.tabs);
    setActiveId(plan.activeId);
    for (const leafId of plan.disposeLeafIds) disposeSession(leafId);
  }, []);

  const newTab = useCallback((cwd?: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((tabs) => [
      ...tabs,
      {
        id: tabId,
        kind: "terminal",
        projectId,
        title: "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  const newBlockTab = useCallback((cwd?: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((tabs) => [
      ...tabs,
      {
        id: tabId,
        kind: "terminal",
        projectId,
        title: "blocks",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
        blocks: true,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === "undefined") return;
    (
      window as unknown as {
        __teraxNewBlockTab?: (cwd?: string) => number | null;
      }
    ).__teraxNewBlockTab = newBlockTab;
  }, [newBlockTab]);

  const newPrivateTab = useCallback((cwd?: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((tabs) => [
      ...tabs,
      {
        id: tabId,
        kind: "terminal",
        projectId,
        title: "private",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
        private: true,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  /**
   * Opens a file in an editor tab.
   *
   * - `pin = true` (default) — opens or activates a **persistent** tab.
   *   If the path is currently in the preview slot it is promoted in-place.
   *   Use this for programmatic opens (New File dialog, navigation, etc.).
   * - `pin = false` — VSCode-style **preview** tab. A single shared slot is
   *   reused: if a persistent tab for the path already exists it is activated;
   *   otherwise the current preview slot is replaced with the new path.
   */
  const openFileTab = useCallback((path: string, pin = true) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    let targetId: number | null = null;
    setTabs((curr) => {
      if (pin) {
        // Persistent open: find any existing editor tab, pin it if needed.
        const existing = curr.find(
          (t) =>
            t.kind === "editor" && t.projectId === projectId && t.path === path,
        );
        if (existing) {
          targetId = existing.id;
          if ((existing as EditorTab).preview) {
            return curr.map((t) =>
              t.id === existing.id ? { ...t, preview: false } : t,
            );
          }
          return curr;
        }
        const id = nextIdRef.current++;
        targetId = id;
        return [
          ...curr,
          {
            id,
            kind: "editor",
            projectId,
            title: basename(path),
            path,
            dirty: false,
            preview: false,
          } satisfies EditorTab,
        ];
      } else {
        // Preview open: persistent tab for this path takes priority.
        const persistent = curr.find(
          (t) =>
            t.kind === "editor" &&
            t.projectId === projectId &&
            t.path === path &&
            !(t as EditorTab).preview,
        );
        if (persistent) {
          targetId = persistent.id;
          return curr;
        }
        // Reuse the slot if it already shows the same path.
        const existingPreview = curr.find(
          (t) =>
            t.kind === "editor" &&
            t.projectId === projectId &&
            t.path === path &&
            (t as EditorTab).preview,
        );
        if (existingPreview) {
          targetId = existingPreview.id;
          return curr;
        }
        // Replace the current preview slot, or append a new one.
        const previewIdx = curr.findIndex(
          (t) =>
            t.kind === "editor" &&
            t.projectId === projectId &&
            (t as EditorTab).preview,
        );
        const id = nextIdRef.current++;
        targetId = id;
        const tab: EditorTab = {
          id,
          kind: "editor",
          projectId,
          title: basename(path),
          path,
          dirty: false,
          preview: true,
        };
        if (previewIdx === -1) return [...curr, tab];
        const next = [...curr];
        next[previewIdx] = tab;
        return next;
      }
    });
    if (targetId !== null) setActiveId(targetId);
    return targetId as number | null;
  }, []);

  /**
   * Promotes a preview tab to a persistent one. Called on double-click of the
   * tab title in the tab bar. Dirty edits also auto-promote (see `updateTab`).
   */
  const pinTab = useCallback((id: number) => {
    setTabs((curr) =>
      curr.map((t) =>
        t.id === id && t.kind === "editor" ? { ...t, preview: false } : t,
      ),
    );
  }, []);

  const newPreviewTab = useCallback((url: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    const existing = tabsRef.current.find(
      (tab) =>
        tab.kind === "preview" &&
        tab.projectId === projectId &&
        tab.url === url,
    );
    if (existing) {
      setActiveId(existing.id);
      return existing.id;
    }
    const id = nextIdRef.current++;
    setTabs((tabs) => [
      ...tabs,
      {
        id,
        kind: "preview",
        projectId,
        title: titleFromUrl(url),
        url,
      },
    ]);
    setActiveId(id);
    return id;
  }, []);

  const newRenderTab = useCallback((path: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    const renderer = previewRendererFor(path)!;
    let targetId: number | null = null;
    setTabs((current) => {
      const existing = current.find(
        (tab) =>
          tab.kind === "render" &&
          tab.projectId === projectId &&
          tab.path === path,
      );
      if (existing) {
        targetId = existing.id;
        return current;
      }
      const id = nextIdRef.current++;
      targetId = id;
      return [
        ...current,
        {
          id,
          kind: "render",
          projectId,
          title: basename(path),
          path,
          renderer,
        } satisfies RenderTab,
      ];
    });
    if (targetId !== null) setActiveId(targetId);
    return targetId;
  }, []);

  const setOverrideLanguage = useCallback((id: number, lang: string | null) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== id || t.kind !== "editor") return t;
        return {
          ...t,
          overrideLanguage: lang,
        };
      }),
    );
  }, []);

  const setRenderView = useCallback((id: number, mode: "rendered" | "raw") => {
    setTabs((curr) =>
      curr.map((t) => {
        if (
          t.id !== id ||
          previewRendererFor((t as { path?: string }).path ?? "") === null
        )
          return t;
        if (mode === "raw" && t.kind === "render") {
          return {
            ...t,
            kind: "editor" as const,
            dirty: false,
            preview: false,
            overrideLanguage: t.overrideLanguage ?? null,
          };
        }
        if (mode === "rendered" && t.kind === "editor") {
          if (t.dirty) return t;
          return {
            id: t.id,
            kind: "render" as const,
            projectId: t.projectId,
            cold: t.cold,
            title: t.title,
            path: t.path,
            renderer: previewRendererFor(t.path)!,
            overrideLanguage: t.overrideLanguage ?? null,
          };
        }
        return t;
      }),
    );
  }, []);

  const openGitDiffTab = useCallback(
    (input: {
      path: string;
      repoRoot: string;
      mode: "-" | "+";
      originalPath?: string | null;
      title?: string;
    }) => {
      const projectId = activeProjectIdRef.current;
      if (!projectId) return null;
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-diff" &&
          t.projectId === projectId &&
          t.repoRoot === input.repoRoot &&
          t.path === input.path &&
          t.mode === input.mode,
      );
      const computedTitle =
        input.title ?? `${basename(input.path)} (${input.mode})`;
      const originalPath = input.originalPath ?? null;

      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id
            ? { ...t, title: computedTitle, originalPath }
            : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }

      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-diff",
          projectId,
          title: computedTitle,
          path: input.path,
          repoRoot: input.repoRoot,
          mode: input.mode,
          originalPath,
        } satisfies GitDiffTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const openCommitHistoryTab = useCallback(
    (input: { repoRoot: string; branch?: string | null }) => {
      const projectId = activeProjectIdRef.current;
      if (!projectId) return null;
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-history" &&
          t.projectId === projectId &&
          t.repoRoot === input.repoRoot,
      );
      const title = input.branch ? `History · ${input.branch}` : "Git History";
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id ? { ...t, title } : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-history",
          projectId,
          title,
          repoRoot: input.repoRoot,
        } satisfies GitHistoryTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const openCommitFileDiffTab = useCallback(
    (input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    }) => {
      const projectId = activeProjectIdRef.current;
      if (!projectId) return null;
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-commit-file" &&
          t.projectId === projectId &&
          t.repoRoot === input.repoRoot &&
          t.sha === input.sha &&
          t.path === input.path,
      );
      const title = `${basename(input.path)} @ ${input.shortSha}`;
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
              }
            : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-commit-file",
          projectId,
          title,
          repoRoot: input.repoRoot,
          sha: input.sha,
          shortSha: input.shortSha,
          subject: input.subject,
          path: input.path,
          originalPath: input.originalPath,
        } satisfies GitCommitFileDiffTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const closeTab = useCallback((id: number) => {
    let toDispose: number[] = [];
    setTabs((current) => {
      const target = current.find((tab) => tab.id === id);
      if (!target) return current;
      if (target.kind === "terminal") toDispose = leafIds(target.paneTree);
      const fallback = nextActiveInProject(current, id);
      const next = current.filter((tab) => tab.id !== id);
      if (activeIdRef.current === id) {
        activeIdRef.current = fallback;
        setActiveId(fallback);
      }
      return next;
    });
    for (const leafId of toDispose) disposeSession(leafId);
  }, []);

  const updateTab = useCallback((id: number, patch: TabPatch) => {
    setTabs((t) =>
      t.map((x) => {
        if (x.id !== id) return x;
        if (x.kind === "terminal") {
          return {
            ...x,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.cwd !== undefined && { cwd: patch.cwd }),
            ...(patch.customTitle !== undefined && {
              customTitle:
                patch.customTitle === "" ? undefined : patch.customTitle,
            }),
          };
        }
        if (x.kind === "preview") {
          return {
            ...x,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.url !== undefined && {
              url: patch.url,
              title: patch.title ?? titleFromUrl(patch.url),
            }),
          };
        }
        if (x.kind === "render") {
          return {
            ...x,
            ...(patch.title !== undefined && { title: patch.title }),
          };
        }
        // editor tab: auto-promote from preview the moment the file becomes dirty.
        const autoPin =
          patch.dirty === true && (x as EditorTab).preview
            ? { preview: false }
            : {};
        return {
          ...x,
          ...autoPin,
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.dirty !== undefined && { dirty: patch.dirty }),
          ...(patch.path !== undefined && { path: patch.path }),
          ...(patch.overrideLanguage !== undefined && {
            overrideLanguage: patch.overrideLanguage,
          }),
        };
      }),
    );
  }, []);

  const selectByIndex = useCallback(
    (idx: number, projectId?: string) => {
      const t = projectId
        ? pickTabByProjectIndex(tabs, idx, projectId)
        : tabs[idx];
      if (t) setActiveId(t.id);
    },
    [tabs],
  );

  /** Update a leaf's cwd; mirror to the tab's `cwd` when the leaf is active.
   * Bails out without setTabs when nothing actually changed — shell integration
   * re-emits OSC 7 on every prompt, including empty Enters, so this fires at
   * keystroke rate. Always-setTabs there cascades a paneTree re-render across
   * every open tab. */
  const setLeafCwd = useCallback((leafId: number, cwd: string) => {
    setTabs((curr) => {
      let changed = false;
      const next = curr.map((t) => {
        if (t.kind !== "terminal" || !hasLeaf(t.paneTree, leafId)) return t;
        const paneTree = setLeafCwdInTree(t.paneTree, leafId, cwd);
        const isActive = t.activeLeafId === leafId;
        const cwdChanged = isActive && t.cwd !== cwd;
        if (paneTree === t.paneTree && !cwdChanged) return t;
        changed = true;
        return { ...t, paneTree, ...(cwdChanged && { cwd }) };
      });
      return changed ? next : curr;
    });
  }, []);

  const focusPane = useCallback((tabId: number, leafId: number) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        if (!hasLeaf(t.paneTree, leafId)) return t;
        if (t.activeLeafId === leafId) return t;
        const cwd = findLeafCwd(t.paneTree, leafId);
        return {
          ...t,
          activeLeafId: leafId,
          ...(cwd !== undefined && { cwd }),
        };
      }),
    );
  }, []);

  const focusNextPaneInTab = useCallback((tabId: number, delta: 1 | -1) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        const next = nextLeafId(t.paneTree, t.activeLeafId, delta);
        if (next === t.activeLeafId) return t;
        const cwd = findLeafCwd(t.paneTree, next);
        return { ...t, activeLeafId: next, ...(cwd !== undefined && { cwd }) };
      }),
    );
  }, []);

  const swapActivePaneInDirection = useCallback(
    (tabId: number, direction: PaneDirection, bounds?: PaneBounds[]) => {
      setTabs((curr) =>
        curr.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t;
          const paneTree = swapLeafInDirection(
            t.paneTree,
            t.activeLeafId,
            direction,
            bounds,
          );
          return paneTree === t.paneTree ? t : { ...t, paneTree };
        }),
      );
    },
    [],
  );

  /** Split the active leaf of `tabId` along `dir`. Returns the new leaf id. */
  const splitActivePane = useCallback(
    (tabId: number, dir: SplitDir): number | null => {
      let newLeafId: number | null = null;
      setTabs((curr) =>
        curr.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal" || t.blocks) return t;
          if (leafIds(t.paneTree).length >= MAX_PANES_PER_TAB) return t;
          const splitId = nextIdRef.current++;
          const leafId = nextIdRef.current++;
          newLeafId = leafId;
          const paneTree = splitLeaf(
            t.paneTree,
            t.activeLeafId,
            splitId,
            leafId,
            dir,
            t.cwd,
          );
          return { ...t, paneTree, activeLeafId: leafId };
        }),
      );
      return newLeafId;
    },
    [],
  );

  const closePaneByLeaf = useCallback((leafId: number): void => {
    let didRemove = false;
    setTabs((curr) => {
      const tab = curr.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return curr;
      const newTree = removeLeaf(tab.paneTree, leafId);
      if (newTree === null) {
        const fallback = nextActiveInProject(curr, tab.id);
        const next = curr.filter((candidate) => candidate.id !== tab.id);
        if (activeIdRef.current === tab.id) {
          activeIdRef.current = fallback;
          setActiveId(fallback);
        }
        didRemove = true;
        return next;
      }
      const remaining = leafIds(newTree);
      let newActive = tab.activeLeafId;
      if (tab.activeLeafId === leafId) {
        const sib = siblingLeafOf(tab.paneTree, leafId);
        newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      }
      didRemove = true;
      return curr.map((x) =>
        x.id === tab.id
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (didRemove) disposeSession(leafId);
  }, []);

  const closeActivePane = useCallback((tabId: number): boolean => {
    let closedTab = false;
    let removedLeaf: number | null = null;
    setTabs((curr) => {
      const t = curr.find((x) => x.id === tabId);
      if (t?.kind !== "terminal") return curr;
      const target = t.activeLeafId;
      const newTree = removeLeaf(t.paneTree, target);
      if (newTree === null) {
        const fallback = nextActiveInProject(curr, tabId);
        const next = curr.filter((candidate) => candidate.id !== tabId);
        if (activeIdRef.current === tabId) {
          activeIdRef.current = fallback;
          setActiveId(fallback);
        }
        closedTab = true;
        removedLeaf = target;
        return next;
      }
      const remaining = leafIds(newTree);
      const sib = siblingLeafOf(t.paneTree, target);
      const newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      removedLeaf = target;
      return curr.map((x) =>
        x.id === tabId
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (removedLeaf !== null) disposeSession(removedLeaf);
    return closedTab;
  }, []);

  const rebaseProjectPaths = useCallback(
    (
      projectId: string,
      oldRoot: string,
      newRoot: string,
      caseInsensitive: boolean,
    ) => {
      const rebaseNode = (node: PaneNode): PaneNode =>
        node.kind === "leaf"
          ? {
              ...node,
              ...(node.cwd && {
                cwd: rebasePath(node.cwd, oldRoot, newRoot, caseInsensitive),
              }),
            }
          : {
              ...node,
              children: node.children.map(rebaseNode),
            };
      setTabs((current) =>
        current.map((tab) => {
          if (tab.projectId !== projectId) return tab;
          if (tab.kind === "terminal") {
            return {
              ...tab,
              ...(tab.cwd && {
                cwd: rebasePath(tab.cwd, oldRoot, newRoot, caseInsensitive),
              }),
              paneTree: rebaseNode(tab.paneTree),
            };
          }
          if (tab.kind === "editor" || tab.kind === "render") {
            return {
              ...tab,
              path: rebasePath(tab.path, oldRoot, newRoot, caseInsensitive),
            };
          }
          return tab;
        }),
      );
    },
    [],
  );

  const reorderTabByGap = useCallback((fromId: number, toGapIndex: number) => {
    setTabs((prev) => reorderTabsByGap(prev, fromId, toGapIndex));
  }, []);

  return {
    tabs,
    activeId,
    setActiveId,
    allocId,
    replaceTabs,
    reorderTabByGap,
    newTabInProject,
    removeTabsForProjects,
    markBooted,
    setActiveProjectForNewTabs,
    setOverrideLanguage,
    newTab,
    newBlockTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newRenderTab,
    setRenderView,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    swapActivePaneInDirection,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    rebaseProjectPaths,
  };
}
