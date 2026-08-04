import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../store/agentStore";
import type { AgentSession } from "./types";

/** A session stuck "working" with no state change for this long no longer
 * holds the machine awake, so an abandoned agent cannot block sleep forever. */
export const KEEP_AWAKE_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

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
  evaluate();
  return () => {
    unsubAgents();
    unsubPrefs();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (applied) {
      applied = false;
      invoke("set_keep_awake", { active: false }).catch(() => {});
    }
  };
}
