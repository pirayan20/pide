import {
  leafIds,
  pickTabAgent,
  ptyIdForLeaf,
  useAgentActivityStore,
  useLeafTitleStore,
} from "@/modules/terminal";
import type { TabAgentContext } from "@/modules/tabs/lib/tabLabel";
import type { Tab } from "@/modules/tabs/lib/useTabs";

export function useTabAgentContext(
  tab: Tab,
  includeTitle = true,
): TabAgentContext | null {
  const phases = useAgentActivityStore((s) => s.phases);
  const agents = useAgentActivityStore((s) => s.agents);
  const pairs: Array<readonly [number, number]> = [];
  if (tab.kind === "terminal" && !tab.private) {
    for (const leaf of leafIds(tab.paneTree)) {
      const ptyId = ptyIdForLeaf(leaf);
      if (ptyId !== null) pairs.push([leaf, ptyId] as const);
    }
  }
  const picked = pickTabAgent(phases, agents, pairs);
  const titleLeaf =
    includeTitle && tab.kind === "terminal" && !tab.customTitle
      ? picked?.leafId
      : null;
  const oscTitle = useLeafTitleStore((s) =>
    titleLeaf == null ? null : (s.titles[titleLeaf] ?? null),
  );
  return picked ? { name: picked.agent, oscTitle } : null;
}
