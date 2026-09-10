import { useMemo } from "react";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { Tab } from "@/modules/tabs";
import { createProjectActivitySelector } from "@/modules/spaces/lib/projectActivity";

export function useProjectActivity(tabs: Tab[]) {
  const select = useMemo(() => createProjectActivitySelector(tabs), [tabs]);
  return useAgentStore(select);
}
