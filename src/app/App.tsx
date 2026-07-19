import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { consumeLaunchFiles, getLaunchDir } from "@/lib/launchDir";
import { native } from "@/lib/native";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import { previewRendererFor } from "@/lib/utils";
import {
  AgentNotificationsBridge,
  nextAttentionTarget,
} from "@/modules/agents";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import {
  type EditorPaneHandle,
  NewEditorDialog,
  useApplyEditorFontSize,
  useEditorFileSync,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import {
  interpreterLabel,
  setLspNavigator,
  usePythonInterpreterStore,
} from "@/modules/lsp";
import type { PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type ShortcutHandlers,
  type ShortcutId,
  shouldDisablePaneSwapShortcut,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarRail,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import {
  activeProjectRoot,
  deleteProjectData,
  ProjectPathDialog,
  ProjectStateView,
  pathsOverlap,
  SpaceSwitcher,
  useSpacePersistence,
  useSpaces,
  useSpacesBoot,
} from "@/modules/spaces";
import { StatusBar } from "@/modules/statusbar";
import {
  TabSwitcherHud,
  useTabSwitcher,
  useTabs,
  useWindowTitle,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  navigateFocusedBlocks,
  type PaneBounds,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { useUsageStore } from "@/modules/usage";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import {
  FOCUS_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useHierarchyCloseGuard } from "./hooks/useHierarchyCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

async function resolveProjectDirectory(path: string, env: WorkspaceEnv) {
  const canonical = await native.canonicalize(path, env);
  const stat = await native.fileStat(canonical, env);
  if (stat.kind !== "dir") throw new Error("Project path must be a directory.");
  return canonical;
}

function projectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export default function App() {
  const {
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
    newTab,
    newBlockTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newRenderTab,
    setRenderView,
    setOverrideLanguage,
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
  } = useTabs();

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useApplyEditorFontSize();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const { home, launchCwdResolved, switchWorkspace, adoptWorkspaceEnv } =
    useWorkspaceSwitcher({ workspaceEnv, setWorkspaceEnv });

  const activeSpaceId = useSpaces((state) => state.activeSpaceId);
  const activeProjectId = useSpaces((state) =>
    state.activeSpaceId
      ? (state.activeProjectBySpace[state.activeSpaceId] ?? null)
      : null,
  );
  const projects = useSpaces((state) => state.projects);
  const activeSpace = useSpaces(
    (state) => state.spaces.find((space) => space.id === activeSpaceId) ?? null,
  );
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const projectAvailability = useSpaces((state) => state.availability);
  const spacesHydrated = useSpaces((state) => state.hydrated);
  const projectTabs = useMemo(
    () => tabs.filter((tab) => tab.projectId === activeProjectId),
    [tabs, activeProjectId],
  );
  const projectTabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of tabs)
      counts[tab.projectId] = (counts[tab.projectId] ?? 0) + 1;
    return counts;
  }, [tabs]);
  const activeTab = projectTabs.find((tab) => tab.id === activeId);
  const projectAvailable =
    activeProject !== null &&
    projectAvailability[activeProject.id] === "available";
  const activeSpaceHasProjects =
    activeSpaceId !== null &&
    projects.some((project) => project.spaceId === activeSpaceId);

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      if (!activeSpaceId) return;
      if (
        useSpaces
          .getState()
          .projects.some((project) => project.spaceId === activeSpaceId)
      ) {
        return;
      }
      const switched = await switchWorkspace(env);
      if (switched) useSpaces.getState().setEnv(activeSpaceId, env);
    },
    [switchWorkspace, activeSpaceId],
  );

  useSpacesBoot({
    ready: launchCwdResolved,
    launchCwd: getLaunchDir() ?? null,
    allocId,
    replaceTabs,
    markBooted,
    setActiveProjectForNewTabs,
    adoptWorkspaceEnv,
  });

  useSpacePersistence({
    tabs,
    activeId,
    activeProjectId,
    enabled: spacesHydrated,
  });

  const lastActiveTabByProject = useRef(new Map<string, number>());
  useEffect(() => {
    if (activeProjectId && activeId !== null && activeTab) {
      lastActiveTabByProject.current.set(activeProjectId, activeId);
    }
  }, [activeProjectId, activeId, activeTab]);

  useEffect(() => {
    const { connect, startAutoRefresh } = useUsageStore.getState();
    for (const p of ["claude", "codex"]) void connect(p);
    return startAutoRefresh();
  }, []);

  const focused = useWindowFocus();
  useEffect(() => {
    if (focused) void useUsageStore.getState().refreshAll();
  }, [focused]);

  const activeTabForProject = useCallback((projectId: string) => {
    const owned = tabsRef.current.filter((tab) => tab.projectId === projectId);
    const remembered = lastActiveTabByProject.current.get(projectId);
    if (
      remembered !== undefined &&
      owned.some((tab) => tab.id === remembered)
    ) {
      return remembered;
    }
    const index = useSpaces.getState().initialActiveIndex[projectId] ?? 0;
    return owned[index ?? 0]?.id ?? owned[0]?.id ?? null;
  }, []);

  const selectProject = useCallback(
    (projectId: string) => {
      const state = useSpaces.getState();
      const project = state.projects.find(
        (candidate) => candidate.id === projectId,
      );
      if (!project) return;
      state.setActiveSpace(project.spaceId);
      state.setActiveProject(project.spaceId, project.id);
      setActiveProjectForNewTabs(project.id);
      setActiveId(
        state.availability[project.id] === "available"
          ? activeTabForProject(project.id)
          : null,
      );
    },
    [activeTabForProject, setActiveId, setActiveProjectForNewTabs],
  );

  useEffect(() => {
    setActiveProjectForNewTabs(activeProjectId);
    if (!spacesHydrated) return;
    if (!activeProjectId || !projectAvailable) {
      setActiveId(null);
      return;
    }
    if (activeTab?.projectId === activeProjectId) return;
    setActiveId(activeTabForProject(activeProjectId));
  }, [
    activeProjectId,
    activeTab,
    projectAvailable,
    spacesHydrated,
    setActiveId,
    setActiveProjectForNewTabs,
    activeTabForProject,
  ]);

  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    const space = useSpaces
      .getState()
      .spaces.find((candidate) => candidate.id === activeSpaceId);
    if (space) void adoptWorkspaceEnv(space.env);
  }, [activeSpaceId, spacesHydrated, adoptWorkspaceEnv]);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{
    mode: "add" | "locate";
    spaceId: string;
    projectId?: string;
  } | null>(null);
  const [projectDialogError, setProjectDialogError] = useState<string | null>(
    null,
  );
  const [projectDialogSubmitting, setProjectDialogSubmitting] = useState(false);

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<
    "commands" | "content"
  >("commands");
  const openCommandPalette = useCallback(
    (mode: "commands" | "content" = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );
  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const explorerRoot = activeProjectRoot(
    projects,
    activeProjectId,
    projectAvailability,
  );

  const pythonInterpreterPath = usePythonInterpreterStore((s) =>
    explorerRoot ? (s.byRoot[explorerRoot] ?? null) : null,
  );
  const pythonInterpreterLabel = pythonInterpreterPath
    ? interpreterLabel(pythonInterpreterPath)
    : null;

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(
      activeId === null ? null : (editorRefs.current.get(activeId) ?? null),
    );
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab });

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(tabsRef);
  const {
    pendingHierarchyClose,
    requestHierarchyClose,
    confirmHierarchyClose,
    cancelHierarchyClose,
  } = useHierarchyCloseGuard(tabs);

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  // Most-recently-used tab ids, most recent first, pruned to live tabs. Drives
  // the Ctrl+Tab quick switcher so it cycles by recency, not strip order.
  const mruRef = useRef<number[]>([]);
  useEffect(() => {
    if (activeId === null) return;
    mruRef.current = [
      activeId,
      ...mruRef.current.filter((id) => id !== activeId),
    ];
  }, [activeId]);
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id));
    mruRef.current = mruRef.current.filter((id) => live.has(id));
  }, [tabs]);

  const getSwitcherOrder = useCallback(() => {
    if (!activeProjectId) return [];
    const owned = tabsRef.current
      .filter((tab) => tab.projectId === activeProjectId)
      .map((tab) => tab.id);
    const present = new Set(owned);
    const ordered = mruRef.current.filter((id) => present.has(id));
    for (const id of owned) if (!ordered.includes(id)) ordered.push(id);
    return activeId === null
      ? ordered
      : [activeId, ...ordered.filter((id) => id !== activeId)];
  }, [activeId, activeProjectId]);

  const { state: switcherState, step: stepSwitcher } = useTabSwitcher({
    getOrder: getSwitcherOrder,
    onCommit: (id) => {
      if (tabsRef.current.some((t) => t.id === id)) setActiveId(id);
    },
  });

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const {
      spaces,
      activeSpaceId: current,
      setActiveSpace,
    } = useSpaces.getState();
    if (spaces.length < 2) return;
    const index = spaces.findIndex((space) => space.id === current);
    const next = (index + delta + spaces.length) % spaces.length;
    setActiveSpace(spaces[next].id);
  }, []);

  const openNewTab = useCallback(() => {
    if (projectAvailable && activeProject) newTab(activeProject.root);
  }, [projectAvailable, activeProject, newTab]);

  const openNewPrivateTab = useCallback(() => {
    if (projectAvailable && activeProject) newPrivateTab(activeProject.root);
  }, [projectAvailable, activeProject, newPrivateTab]);

  const openNewBlockTab = useCallback(() => {
    if (projectAvailable && activeProject) newBlockTab(activeProject.root);
  }, [projectAvailable, activeProject, newBlockTab]);

  const openNewEditor = useCallback(() => {
    if (projectAvailable) setNewEditorOpen(true);
  }, [projectAvailable]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (tab?.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Files with a renderer open in their rendered view by default; a
      // per-tab toggle flips to the raw editor. Other files default to
      // preview (pin=false); explicit actions like context-menu "Open" pass
      // pin=true to persist.
      if (previewRendererFor(path)) newRenderTab(path);
      else openFileTab(path, pin ?? false);
    },
    [openFileTab, newRenderTab],
  );

  const [pendingLaunchFiles, setPendingLaunchFiles] = useState<string[]>([]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const queue = (paths: string[]) => {
      if (paths.length > 0) {
        setPendingLaunchFiles((current) => [...current, ...paths]);
      }
    };
    void listen<string[]>("terax:open-file", (event) =>
      queue(event.payload),
    ).then((stop) => {
      unlisten = stop;
    });
    void consumeLaunchFiles().then(queue);
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!spacesHydrated || pendingLaunchFiles.length === 0) return;
    if (!activeProjectId || !projectAvailable) {
      toast.error("Open a Project before opening files.");
    } else {
      for (const path of pendingLaunchFiles) handleOpenFile(path, true);
    }
    setPendingLaunchFiles((current) =>
      current.slice(pendingLaunchFiles.length),
    );
  }, [
    spacesHydrated,
    pendingLaunchFiles,
    activeProjectId,
    projectAvailable,
    handleOpenFile,
  ]);

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "render"
      ? activeTab.path
      : null;
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      projectRoot: explorerRoot,
      cycleSidebarView,
      openCommitHistoryTab,
    });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url && id !== null) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  // Open a local HTML file in the browser preview tab via the asset protocol.
  const openHtmlPreview = useCallback(
    (path: string) => {
      openPreviewTab(convertFileSrc(path));
    },
    [openPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      if (activeId === null) return;
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (t?.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const livePaneBounds = useCallback((tabId: number): PaneBounds[] => {
    const tab = document.querySelector<HTMLElement>(
      `[data-terminal-tab="${tabId}"]`,
    );
    if (!tab) return [];
    return [...tab.querySelectorAll<HTMLElement>("[data-pane-leaf]")].flatMap(
      (element) => {
        const id = Number(element.dataset.paneLeaf);
        if (!Number.isFinite(id)) return [];
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return [{ id, left, right, top, bottom }];
      },
    );
  }, []);

  const swapActivePane = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      if (activeId === null) return;
      swapActivePaneInDirection(activeId, direction, livePaneBounds(activeId));
    },
    [activeId, livePaneBounds, swapActivePaneInDirection],
  );

  const handleCloseTabOrPane = useCallback(() => {
    if (activeId === null) return;
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const activateAgentTarget = useCallback(
    (tabId: number, leafId: number) => {
      const projectId = tabsRef.current.find(
        (tab) => tab.id === tabId,
      )?.projectId;
      const project = useSpaces
        .getState()
        .projects.find((candidate) => candidate.id === projectId);
      if (project) {
        useSpaces.getState().setActiveSpace(project.spaceId);
        useSpaces.getState().setActiveProject(project.spaceId, project.id);
        setActiveProjectForNewTabs(project.id);
      }
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane, setActiveProjectForNewTabs],
  );

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": openNewEditor,
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => stepSwitcher(1),
      "tab.prev": () => stepSwitcher(-1),
      "tab.selectByIndex": (e) => {
        if (activeProjectId) {
          selectByIndex(parseInt(e.key, 10) - 1, activeProjectId);
        }
      },
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => {
        if (activeId !== null) focusNextPaneInTab(activeId, 1);
      },
      "pane.focusPrev": () => {
        if (activeId !== null) focusNextPaneInTab(activeId, -1);
      },
      "pane.swapLeft": () => swapActivePane("left"),
      "pane.swapRight": () => swapActivePane("right"),
      "pane.swapUp": () => swapActivePane("up"),
      "pane.swapDown": () => swapActivePane("down"),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(FOCUS_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => {
        const editor =
          activeId === null ? undefined : editorRefs.current.get(activeId);
        if (editor) editor.openSearch();
        else searchInlineRef.current?.focus();
      },
      "agent.focusAttention": () => {
        const t = nextAttentionTarget();
        if (t) activateAgentTarget(t.tabId, t.leafId);
      },
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => {
        if (activeId !== null) editorRefs.current.get(activeId)?.undo();
      },
      "editor.redo": () => {
        if (activeId !== null) editorRefs.current.get(activeId)?.redo();
      },
    }),
    [
      activeId,
      openCommandPalette,
      stepSwitcher,
      cycleSpace,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewEditor,
      openPreviewTab,
      activeProjectId,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      swapActivePane,
      toggleSourceControl,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
      activateAgentTarget,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      const terminalPaneCount =
        activeTab?.kind === "terminal"
          ? leafIds(activeTab.paneTree).length
          : null;
      if (shouldDisablePaneSwapShortcut(id, terminalPaneCount)) return true;
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const line = pendingGotoLine.current.get(id);
        if (line != null) {
          pendingGotoLine.current.delete(id);
          h.gotoLine(line);
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        const tab = tabsRef.current.find(
          (candidate) =>
            candidate.kind === "terminal" &&
            hasLeaf(candidate.paneTree, leafId),
        );
        const project = useSpaces
          .getState()
          .projects.find((candidate) => candidate.id === tab?.projectId);
        const space = useSpaces
          .getState()
          .spaces.find((candidate) => candidate.id === project?.spaceId);
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd, space?.env).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = activateAgentTarget;

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return;
      closePaneByLeaf(leafId);
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;

  const openAddProject = useCallback((spaceId: string) => {
    setProjectDialogError(null);
    setProjectDialog({ mode: "add", spaceId });
    setSwitcherOpen(false);
  }, []);

  const openLocateProject = useCallback((projectId: string) => {
    const project = useSpaces
      .getState()
      .projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    setProjectDialogError(null);
    setProjectDialog({ mode: "locate", spaceId: project.spaceId, projectId });
    setSwitcherOpen(false);
  }, []);

  const browseProjectFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      return typeof selected === "string" ? selected : null;
    } catch (error) {
      setProjectDialogError(String(error));
      return null;
    }
  }, []);

  const submitProjectPath = useCallback(
    async (path: string) => {
      if (!projectDialog) return;
      const state = useSpaces.getState();
      const space = state.spaces.find(
        (candidate) => candidate.id === projectDialog.spaceId,
      );
      const relocating = projectDialog.projectId
        ? state.projects.find(
            (candidate) => candidate.id === projectDialog.projectId,
          )
        : null;
      if (!space || (projectDialog.mode === "locate" && !relocating)) return;

      setProjectDialogSubmitting(true);
      setProjectDialogError(null);
      try {
        const canonical = await resolveProjectDirectory(path, space.env);
        const caseInsensitive = space.env.kind === "local" && IS_WINDOWS;
        const overlaps = state.projects
          .filter(
            (project) =>
              project.spaceId === space.id && project.id !== relocating?.id,
          )
          .some((project) =>
            pathsOverlap(project.root, canonical, caseInsensitive),
          );
        if (overlaps) {
          throw new Error(
            "This folder overlaps an existing Project in this Space.",
          );
        }
        await native.workspaceAuthorize(canonical, space.env);
        await adoptWorkspaceEnv(space.env);

        if (relocating) {
          rebaseProjectPaths(
            relocating.id,
            relocating.root,
            canonical,
            caseInsensitive,
          );
          state.relocateProject(relocating.id, canonical);
          state.setProjectAvailability(relocating.id, "available");
          selectProject(relocating.id);
        } else {
          const project = state.createProject({
            spaceId: space.id,
            name: projectName(canonical),
            root: canonical,
          });
          state.setActiveSpace(space.id);
          state.setActiveProject(space.id, project.id);
          state.setProjectAvailability(project.id, "available");
          setActiveProjectForNewTabs(project.id);
          setActiveId(newTabInProject(project.id, project.root));
        }
        setProjectDialog(null);
      } catch (error) {
        setProjectDialogError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setProjectDialogSubmitting(false);
      }
    },
    [
      projectDialog,
      adoptWorkspaceEnv,
      newTabInProject,
      rebaseProjectPaths,
      selectProject,
      setActiveId,
      setActiveProjectForNewTabs,
    ],
  );

  const removeProjectConfirmed = useCallback(
    async (projectId: string) => {
      removeTabsForProjects([projectId]);
      await deleteProjectData(projectId);
      const next = useSpaces.getState().removeProjectMetadata(projectId);
      if (next) selectProject(next);
      else {
        setActiveProjectForNewTabs(null);
        setActiveId(null);
      }
    },
    [
      removeTabsForProjects,
      selectProject,
      setActiveId,
      setActiveProjectForNewTabs,
    ],
  );

  const handleNewSpace = useCallback(() => {
    const { spaces, createSpace, setActiveSpace, setActiveProject } =
      useSpaces.getState();
    const space = createSpace({
      name: `Space ${spaces.length + 1}`,
      env: workspaceEnv,
    });
    setActiveSpace(space.id);
    setActiveProject(space.id, null);
    setActiveProjectForNewTabs(null);
    setActiveId(null);
    return space.id;
  }, [workspaceEnv, setActiveId, setActiveProjectForNewTabs]);

  const deleteSpaceConfirmed = useCallback(
    async (id: string) => {
      const projectIds = useSpaces
        .getState()
        .projects.filter((project) => project.spaceId === id)
        .map((project) => project.id);
      removeTabsForProjects(projectIds);
      await Promise.all(projectIds.map(deleteProjectData));
      useSpaces.getState().removeSpaceMetadata(id);
    },
    [removeTabsForProjects],
  );

  const requestProjectRemoval = useCallback(
    (projectId: string) => {
      const project = useSpaces
        .getState()
        .projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const tabIds = tabsRef.current
        .filter((tab) => tab.projectId === projectId)
        .map((tab) => tab.id);
      void requestHierarchyClose(
        {
          kind: "project",
          id: project.id,
          name: project.name,
          tabIds,
        },
        () => removeProjectConfirmed(project.id),
      );
    },
    [removeProjectConfirmed, requestHierarchyClose],
  );

  const requestSpaceDeletion = useCallback(
    (spaceId: string) => {
      const state = useSpaces.getState();
      const space = state.spaces.find((candidate) => candidate.id === spaceId);
      if (!space) return;
      const projectIds = new Set(
        state.projects
          .filter((project) => project.spaceId === spaceId)
          .map((project) => project.id),
      );
      const tabIds = tabsRef.current
        .filter((tab) => projectIds.has(tab.projectId))
        .map((tab) => tab.id);
      void requestHierarchyClose(
        { kind: "space", id: space.id, name: space.name, tabIds },
        () => deleteSpaceConfirmed(space.id),
      );
    },
    [deleteSpaceConfirmed, requestHierarchyClose],
  );

  const spaceSwitcher = (
    <SpaceSwitcher
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      onNewSpace={() => void handleNewSpace()}
      onDeleteSpace={requestSpaceDeletion}
      onAddProject={openAddProject}
      onLocateProject={openLocateProject}
      onRemoveProject={requestProjectRemoval}
      onSelectProject={selectProject}
      projectTabCounts={projectTabCounts}
      onReorderSpaces={(ids) => useSpaces.getState().reorderSpaces(ids)}
      onReorderProjects={(spaceId, ids) =>
        useSpaces.getState().reorderProjects(spaceId, ids)
      }
    />
  );

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            pythonInterpreterLabel,
            openNewTab,
            openNewBlock: openNewBlockTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor,
            openNewPreview: () => openPreviewTab(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: handleCloseTabOrPane,
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            projects: projects.filter(
              (project) => project.spaceId === activeSpaceId,
            ),
            activeProjectId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: () => void handleNewSpace(),
            switchSpace: (id) => useSpaces.getState().setActiveSpace(id),
            switchProject: selectProject,
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      pythonInterpreterLabel,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewEditor,
      openPreviewTab,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      splitActivePaneInActiveTab,
      toggleSidebar,
      activeSpaceId,
      activeProjectId,
      projects,
      selectProject,
      handleNewSpace,
    ],
  );

  useEffect(() => {
    if (commandPaletteOpen && explorerRoot) {
      void usePythonInterpreterStore.getState().resolve(explorerRoot);
    }
  }, [commandPaletteOpen, explorerRoot]);

  const pendingGotoLine = useRef<Map<number, number>>(new Map());
  const openContentHit = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      const h = editorRefs.current.get(id);
      if (h) h.gotoLine(line);
      else pendingGotoLine.current.set(id, line);
    },
    [openFileTab],
  );

  useEffect(() => {
    setLspNavigator({ openFile: openContentHit });
    return () => setLspNavigator(null);
  }, [openContentHit]);

  const insertHistoryCommand = useMemo(
    () =>
      isTerminalTab && activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            terminalRefs.current.get(activeLeafId)?.focus();
          }
        : null,
    [isTerminalTab, activeLeafId],
  );

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={projectTabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={openNewEditor}
              onNewGitGraph={openGitGraphFromContext}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onReorder={reorderTabByGap}
              onToggleSidebar={toggleSidebar}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={onActivateAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={spaceSwitcher}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
              creationDisabled={!projectAvailable}
              onOverrideLanguage={setOverrideLanguage}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                  persistSidebarCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <div
                    key={sidebarView}
                    className="min-h-0 flex-1 terax-panel-in"
                  >
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerRoot}
                        gitStatus={
                          explorerGitDecorations ? sourceControl.status : null
                        }
                        activeFilePath={explorerActiveFilePath}
                        onOpenFile={handleOpenFile}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                        onOpenFile={handleOpenFile}
                        onNavigateToPath={cdInNewTab}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <WorkspaceSurface
                      tabs={tabs}
                      activeId={activeId}
                      activeTab={activeTab}
                      hierarchyState={
                        <ProjectStateView
                          activeSpace={activeSpace}
                          activeProject={activeProject}
                          availability={
                            activeProject
                              ? (projectAvailability[activeProject.id] ?? null)
                              : null
                          }
                          onCreateSpace={() => void handleNewSpace()}
                          onAddProject={openAddProject}
                          onNewTerminal={openNewTab}
                          onLocateProject={openLocateProject}
                          onRemoveProject={requestProjectRemoval}
                        />
                      }
                      registerTerminalHandle={registerTerminalHandle}
                      onSearchReady={handleSearchReady}
                      onCwd={handleTerminalCwd}
                      onExit={handleLeafExit}
                      onFocusLeaf={handleFocusLeaf}
                      registerEditorHandle={registerEditorHandle}
                      onEditorDirtyChange={handleEditorDirty}
                      onEditorCloseTab={disposeTab}
                      registerPreviewHandle={registerPreviewHandle}
                      onPreviewUrlChange={handlePreviewUrl}
                      onOpenCommitFile={openCommitFileDiffTab}
                      onGitHistorySearchHandle={setGitHistoryHandle}
                      onSetRenderView={setRenderView}
                      onOpenPreview={openHtmlPreview}
                    />
                  </div>

                  <WorkspaceInputBar
                    isBlockTab={isBlockTab}
                    activeLeafId={activeLeafId}
                    cwd={activeCwd}
                    home={home}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={handleWorkspaceChange}
              workspaceEnvDisabled={activeSpaceHasProjects}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

          {switcherState && (
            <TabSwitcherHud tabs={projectTabs} state={switcherState} />
          )}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={insertHistoryCommand}
          />

          <ProjectPathDialog
            open={projectDialog !== null}
            mode={projectDialog?.mode ?? "add"}
            spaceName={
              useSpaces
                .getState()
                .spaces.find((space) => space.id === projectDialog?.spaceId)
                ?.name ?? "Space"
            }
            allowBrowse={
              useSpaces
                .getState()
                .spaces.find((space) => space.id === projectDialog?.spaceId)
                ?.env.kind === "local"
            }
            initialPath={
              projectDialog?.projectId
                ? useSpaces
                    .getState()
                    .projects.find(
                      (project) => project.id === projectDialog.projectId,
                    )?.root
                : undefined
            }
            error={projectDialogError}
            submitting={projectDialogSubmitting}
            onOpenChange={(open) => {
              if (!open && !projectDialogSubmitting) setProjectDialog(null);
            }}
            onBrowse={browseProjectFolder}
            onSubmit={submitProjectPath}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
            pendingHierarchyClose={pendingHierarchyClose}
            onCancelHierarchyClose={cancelHierarchyClose}
            onConfirmHierarchyClose={() => void confirmHierarchyClose()}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return shell;
}
