import { create } from "zustand";
import type { AgentSession, AgentStatus } from "../lib/types";

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  start: (
    leafId: number,
    tabId: number,
    agent: string,
    context?: string | null,
  ) => void;
  setStatus: (leafId: number, status: AgentStatus) => void;
  markHookDriven: (leafId: number) => void;
  finish: (leafId: number) => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},

  start: (leafId, tabId, agent, context = null) =>
    set((s) => {
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            leafId,
            tabId,
            agent,
            status: "working",
            startedAt: now,
            lastActivityAt: now,
            attentionSince: null,
            hookDriven: false,
            context,
          },
        },
      };
    }),

  setStatus: (leafId, status) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.status === status) return s;
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            ...prev,
            status,
            lastActivityAt: now,
            attentionSince: status === "waiting" ? now : null,
          },
        },
      };
    }),

  markHookDriven: (leafId) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.hookDriven) return s;
      return {
        sessions: { ...s.sessions, [leafId]: { ...prev, hookDriven: true } },
      };
    }),

  finish: (leafId) =>
    set((s) => {
      if (!s.sessions[leafId]) return s;
      const next = { ...s.sessions };
      delete next[leafId];
      return { sessions: next };
    }),
}));

/** The tab/leaf of the agent that most recently entered the waiting state, for
 *  the keyboard jump-to-attention shortcut. Null when none is waiting. */
export function nextAttentionTarget(): {
  tabId: number;
  leafId: number;
} | null {
  const waiting = Object.values(useAgentStore.getState().sessions)
    .filter((s) => s.status === "waiting")
    .sort((a, b) => (b.attentionSince ?? 0) - (a.attentionSince ?? 0));
  const t = waiting[0];
  return t ? { tabId: t.tabId, leafId: t.leafId } : null;
}
