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
  /** Refresh lastActivityAt without a transition. The keep-awake heartbeat
   * calls this while the pty still emits output, so staleness measures real
   * silence instead of time since the working phase began. */
  touch: (leafId: number) => void;
  markHookDriven: (leafId: number) => void;
  acknowledge: (leafId: number) => void;
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
            status: "idle",
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
            attentionSince: ["waiting", "finished", "error"].includes(status)
              ? now
              : null,
          },
        },
      };
    }),

  acknowledge: (leafId) =>
    set((s) => {
      const session = s.sessions[leafId];
      if (!session || !["finished", "error"].includes(session.status)) return s;
      return {
        sessions: {
          ...s.sessions,
          [leafId]: { ...session, status: "idle", attentionSince: null },
        },
      };
    }),

  touch: (leafId) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.status !== "working") return s;
      return {
        sessions: {
          ...s.sessions,
          [leafId]: { ...prev, lastActivityAt: Date.now() },
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

/** Input requests precede errors and unread completions; oldest wins ties. */
export function nextAttentionTarget(tabIds?: readonly number[]): {
  tabId: number;
  leafId: number;
} | null {
  const waiting = Object.values(useAgentStore.getState().sessions)
    .filter(
      (s) =>
        ["waiting", "error", "finished"].includes(s.status) &&
        (!tabIds || tabIds.includes(s.tabId)),
    )
    .sort((a, b) => {
      const order = ["waiting", "error", "finished"];
      return (
        order.indexOf(a.status) - order.indexOf(b.status) ||
        (a.attentionSince ?? 0) - (b.attentionSince ?? 0)
      );
    });
  const t = waiting[0];
  return t ? { tabId: t.tabId, leafId: t.leafId } : null;
}
