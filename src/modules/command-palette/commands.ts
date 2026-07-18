import type { SearchTarget } from "@/modules/header";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import {
  Cancel01Icon,
  DashboardSquare01Icon,
  FileEditIcon,
  FileSearchIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  PaintBoardIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import type { PaletteItem } from "./types";

export const COMMAND_GROUPS = [
  "General",
  "Spaces",
  "Tabs",
  "Panes",
  "Git",
  "Search",
  "View",
] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number | null;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  pythonInterpreterLabel: string | null;
  openNewTab: () => void;
  openNewBlock: () => void;
  openNewPrivate: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  openGitGraph: () => void;
  toggleSourceControl: () => void;
  closeActiveTabOrPane: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  spaces: { id: string; name: string }[];
  activeSpaceId: string | null;
  projects: { id: string; name: string }[];
  activeProjectId: string | null;
  openSpacesOverview: () => void;
  newSpace: () => void;
  switchSpace: (id: string) => void;
  switchProject: (id: string) => void;
};

const noop = () => {};

export function createCommandItems(
  ctx: CommandPaletteActionContext,
): PaletteItem[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const noProject = !ctx.explorerRoot;
  const splitDisabled = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount >= MAX_PANES_PER_TAB
      ? "Pane limit"
      : undefined;
  const closeDisabled = activeTab ? undefined : "No active tab";

  return [
    {
      id: "settings.open",
      title: "Open settings",
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
    },
    {
      id: "theme.pick",
      title: "Change theme...",
      group: "General",
      keywords: ["theme", "appearance", "color", "dark", "light"],
      icon: PaintBoardIcon,
      run: noop,
    },
    {
      id: "shortcuts.open",
      title: "Keyboard shortcuts",
      group: "General",
      keywords: ["keys", "keybindings", "settings"],
      icon: KeyboardIcon,
      run: ctx.openKeyboardShortcuts,
    },
    {
      id: "python.selectInterpreter",
      title: "Python: Select Interpreter",
      group: "General",
      keywords: ["python", "interpreter", "venv", "environment", "pyright"],
      icon: SourceCodeIcon,
      trailing: ctx.pythonInterpreterLabel ?? undefined,
      disabledReason: noProject ? "No project selected" : undefined,
      run: noop,
    },
    {
      id: "spaces.overview",
      title: "Spaces: Overview",
      group: "Spaces",
      keywords: [
        "spaces",
        "sessions",
        "overview",
        "organize",
        "manage",
        "move",
      ],
      icon: DashboardSquare01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "spaces.new",
      title: "New Space",
      group: "Spaces",
      keywords: ["space", "session", "workspace", "group", "create"],
      icon: DashboardSquare01Icon,
      run: ctx.newSpace,
    },
    ...ctx.spaces.map((space) => ({
      id: `spaces.switch.${space.id}`,
      title: `Switch to ${space.name}`,
      group: "Spaces" as const,
      keywords: ["space", "switch", "session", space.name],
      icon: DashboardSquare01Icon,
      disabledReason:
        space.id === ctx.activeSpaceId ? "Current space" : undefined,
      run: () => ctx.switchSpace(space.id),
    })),
    ...ctx.projects.map((project) => ({
      id: `projects.switch.${project.id}`,
      title: `Switch to ${project.name}`,
      group: "Spaces" as const,
      keywords: ["project", "folder", "switch", project.name],
      icon: DashboardSquare01Icon,
      disabledReason:
        project.id === ctx.activeProjectId ? "Current project" : undefined,
      run: () => ctx.switchProject(project.id),
    })),
    {
      id: "tab.new",
      title: "New terminal",
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openNewTab,
    },
    {
      id: "tab.newBlock",
      title: "New block terminal",
      group: "Tabs",
      keywords: ["blocks", "warp", "command blocks", "terminal"],
      icon: DashboardSquare01Icon,
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openNewBlock,
    },
    {
      id: "tab.newPrivate",
      title: "New private terminal",
      group: "Tabs",
      keywords: ["privacy", "private", "incognito", "not restored"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openNewPrivate,
    },
    {
      id: "tab.newEditor",
      title: "New editor tab",
      group: "Tabs",
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openNewEditor,
    },
    {
      id: "tab.newPreview",
      title: "New web preview",
      group: "Tabs",
      keywords: ["browser", "web", "localhost", "preview"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      title: "Close tab or pane",
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "pane.splitRight",
      title: "Split pane right",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitDisabled,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      title: "Split pane down",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitDisabled,
      run: ctx.splitPaneDown,
    },
    {
      id: "git.graph",
      title: "Open git graph",
      group: "Git",
      keywords: ["git", "graph", "history", "log", "commits"],
      icon: SourceCodeIcon,
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.openGitGraph,
    },
    {
      id: "git.source",
      title: "Toggle source control",
      group: "Git",
      keywords: ["git", "source control", "changes", "staging", "diff"],
      icon: SourceCodeIcon,
      shortcutId: "pane.source",
      run: ctx.toggleSourceControl,
    },
    {
      id: "search.content",
      title: "Find content in files",
      group: "Search",
      keywords: ["grep", "ripgrep", "text", "contents", "search in files"],
      icon: FileSearchIcon,
      trailing: "#",
      disabledReason: noProject ? "No project selected" : undefined,
      run: noop,
    },
    {
      id: "history.open",
      title: "Search command history",
      group: "Search",
      keywords: ["history", "shell", "rerun", "previous commands"],
      icon: TerminalIcon,
      trailing: ">",
      run: noop,
    },
    {
      id: "search.focus",
      title: "Find in current tab",
      group: "Search",
      keywords: ["find", "terminal", "editor", "current"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget ? undefined : "No searchable view",
      run: ctx.focusSearch,
    },
    {
      id: "explorer.search",
      title: "Search files by name",
      group: "Search",
      keywords: ["explorer", "workspace", "file", "open"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: noProject ? "No project selected" : undefined,
      run: ctx.focusExplorerSearch,
    },
    {
      id: "sidebar.toggle",
      title: "Toggle file explorer",
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
  ];
}
