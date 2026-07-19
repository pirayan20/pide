export { TabBar, TabIcon } from "./TabBar";
export { TabSwitcherHud } from "./TabSwitcherHud";
export {
  useTabSwitcher,
  type TabSwitcherState,
} from "./lib/useTabSwitcher";
export { labelFor } from "./lib/tabLabel";
export {
  MAX_PANES_PER_TAB,
  useTabs,
  nextActiveInProject,
  pickTabByProjectIndex,
  planProjectTabsRemoval,
  type Tab,
  type TerminalTab,
  type EditorTab,
  type PreviewTab,
  type RenderTab,
  type MarkdownTab,
  type GitDiffTab,
  type GitHistoryTab,
  type GitCommitFileDiffTab,
  type TabPatch,
} from "./lib/useTabs";
export { useWindowTitle } from "./lib/useWindowTitle";
