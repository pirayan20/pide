import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentSignal = { id: number; kind: string; agent?: string | null };

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  agents: Record<number, string>;
  setPhase: (id: number, phase: AgentPhase) => void;
  start: (id: number, agent: string) => void;
  clear: (id: number) => void;
};

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  agents: {},
  setPhase: (id, phase) =>
    set((s) => {
      if (s.phases[id] === phase) return s;
      return { phases: { ...s.phases, [id]: phase } };
    }),
  start: (id, agent) =>
    set((s) => ({
      phases: { ...s.phases, [id]: "working" },
      agents: { ...s.agents, [id]: agent },
    })),
  clear: (id) =>
    set((s) => {
      if (!(id in s.phases) && !(id in s.agents)) return s;
      const phases = { ...s.phases };
      const agents = { ...s.agents };
      delete phases[id];
      delete agents[id];
      return { phases, agents };
    }),
}));

const FINISHED_TTL_MS = 6000;
const finishedTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearFinishedTimer(id: number): void {
  const t = finishedTimers.get(id);
  if (t) {
    clearTimeout(t);
    finishedTimers.delete(id);
  }
}

let onExited: ((ptyId: number) => void) | null = null;
let bound = false;

/** Maps a raw detector signal to the phase it drives, `"exited"` to drop the
 * pty, or `null` to ignore. Pure so the mapping stays unit-testable. */
export function phaseForSignal(
  kind: string,
): Exclude<AgentPhase, "idle"> | "exited" | null {
  switch (kind) {
    case "started":
    case "working":
      return "working";
    case "attention":
      return "attention";
    case "finished":
      return "finished";
    case "exited":
      return "exited";
    default:
      return null;
  }
}

// The Rust detector arms via the Claude Code / Codex / Gemini OSC 777 marker and
// reports per-pty lifecycle: started, working, attention, finished, exited.
export function ensureAgentActivityListener(
  exited: (ptyId: number) => void,
): void {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<AgentSignal>("terax:agent-signal", (e) => {
    const { id } = e.payload;
    const action = phaseForSignal(e.payload.kind);
    if (action === null) return;
    clearFinishedTimer(id);
    const store = useAgentActivityStore.getState();
    if (action === "exited") {
      store.clear(id);
      onExited?.(id);
      return;
    }
    if (e.payload.kind === "started") {
      store.start(id, e.payload.agent ?? "agent");
    } else {
      store.setPhase(id, action);
    }
    if (action === "finished") {
      finishedTimers.set(
        id,
        setTimeout(() => {
          finishedTimers.delete(id);
          const s = useAgentActivityStore.getState();
          if (s.phases[id] === "finished") s.setPhase(id, "idle");
        }, FINISHED_TTL_MS),
      );
    }
  });
}

export function isAgentActivePty(ptyId: number): boolean {
  return ptyId in useAgentActivityStore.getState().phases;
}

export type AgentTabStatus = {
  top: "attention" | "working" | "finished" | null;
  count: number;
};

// Highest-severity phase wins the dot; `count` is how many agents share it, so
// the number always matches what the dot represents (never over-counts across
// phases). attention > working > finished; idle/absent are ignored.
export function aggregateAgentPhases(
  phases: Record<number, AgentPhase>,
  ptyIds: readonly number[],
): AgentTabStatus {
  const counts = { attention: 0, working: 0, finished: 0 };
  for (const id of ptyIds) {
    const phase = phases[id];
    if (phase === "attention" || phase === "working" || phase === "finished") {
      counts[phase]++;
    }
  }
  const top: AgentTabStatus["top"] =
    counts.attention > 0
      ? "attention"
      : counts.working > 0
        ? "working"
        : counts.finished > 0
          ? "finished"
          : null;
  return { top, count: top ? counts[top] : 0 };
}

const PHASE_RANK: Record<AgentPhase, number> = {
  attention: 3,
  working: 2,
  finished: 1,
  idle: 0,
};

/** Agent shown on a tab: the one whose pty has the highest-severity phase.
 * Presence (any phase, including idle) keeps the agent visible until exit. */
export function pickTabAgent(
  phases: Record<number, AgentPhase>,
  agents: Record<number, string>,
  pairs: ReadonlyArray<readonly [number, number]>,
): { agent: string; leafId: number } | null {
  let best: { agent: string; leafId: number } | null = null;
  let bestRank = -1;
  for (const [leafId, ptyId] of pairs) {
    const phase = phases[ptyId];
    const agent = agents[ptyId];
    if (phase === undefined || !agent) continue;
    const rank = PHASE_RANK[phase];
    if (rank > bestRank) {
      bestRank = rank;
      best = { agent, leafId };
    }
  }
  return best;
}

export function agentForPty(ptyId: number): string | null {
  return useAgentActivityStore.getState().agents[ptyId] ?? null;
}
