import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../store/agentStore";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";
import type { AgentSession } from "./types";

/** A session stuck "working" with no activity for this long no longer holds
 * the machine awake. The heartbeat below refreshes lastActivityAt while the
 * pty still emits output, so this cap only ever fires on true silence - a
 * hung or abandoned agent. Must stay longer than the longest silent agent
 * thinking phase (no PTY bytes at all), which is why it is minutes not seconds. */
export const KEEP_AWAKE_STALE_AFTER_MS = 10 * 60 * 1000;
/** How often the heartbeat polls pty output recency while sessions exist. */
const HEARTBEAT_INTERVAL_MS = 30_000;

export function keepAwakeEligible(
  sessions: AgentSession[],
  enabled: boolean,
  now: number,
): boolean {
  return (
    enabled &&
    sessions.some(
      (s) =>
        s.status === "working" &&
        now - s.lastActivityAt <= KEEP_AWAKE_STALE_AFTER_MS,
    )
  );
}

/** Earliest instant a currently-working session goes stale, or null. */
export function nextStaleDeadline(
  sessions: AgentSession[],
  now: number,
): number | null {
  let earliest: number | null = null;
  for (const s of sessions) {
    if (s.status !== "working") continue;
    const expiry = s.lastActivityAt + KEEP_AWAKE_STALE_AFTER_MS;
    if (expiry > now && (earliest === null || expiry < earliest)) {
      earliest = expiry;
    }
  }
  return earliest;
}

let applied = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

async function heartbeatTick(): Promise<void> {
  const store = useAgentStore.getState();
  const working = Object.values(store.sessions).filter(
    (s) => s.status === "working",
  );
  for (const s of working) {
    const ptyId = ptyIdForLeaf(s.leafId);
    if (ptyId === null) continue;
    const active = await invoke<boolean>("pty_agent_recently_active", {
      id: ptyId,
    }).catch(() => false);
    if (active) store.touch(s.leafId);
  }
  // Re-assert while held so the backend re-evaluates its display gate: an
  // agent that started on AC must stop pinning the screen once unplugged.
  if (applied) {
    await invoke("set_keep_awake", { active: true }).catch(() => {});
  }
}

function evaluate(): void {
  const enabled = usePreferencesStore.getState().agentKeepAwake;
  const sessions = Object.values(useAgentStore.getState().sessions);
  const now = Date.now();
  const eligible = keepAwakeEligible(sessions, enabled, now);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (eligible) {
    // Re-check at the stale boundary; no store write happens at that instant.
    const deadline = nextStaleDeadline(sessions, now);
    if (deadline !== null) timer = setTimeout(evaluate, deadline - now);
  }
  if (eligible === applied) return;
  applied = eligible;
  invoke("set_keep_awake", { active: eligible }).catch((e) =>
    console.warn("[pide] set_keep_awake failed:", e),
  );
}

export function initKeepAwake(): () => void {
  const unsubAgents = useAgentStore.subscribe(evaluate);
  const unsubPrefs = usePreferencesStore.subscribe(evaluate);
  heartbeat = setInterval(() => {
    void heartbeatTick();
  }, HEARTBEAT_INTERVAL_MS);
  evaluate();
  return () => {
    unsubAgents();
    unsubPrefs();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (applied) {
      applied = false;
      invoke("set_keep_awake", { active: false }).catch(() => {});
    }
  };
}
