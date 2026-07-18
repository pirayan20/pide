import { usePreferencesStore } from "@/modules/settings/preferences";
import { showAgentToast } from "../components/AgentToast";
import { useAgentStore } from "../store/agentStore";
import { osNotify } from "./notify";
import type { AgentSource, NotificationKind } from "./types";

type RouteArgs = {
  source: AgentSource;
  agent: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  focused: boolean;
  /** True when the user is currently looking at this agent. */
  visible: boolean;
  /** Allow an in-app toast when focused but not looking at the agent. */
  allowToast: boolean;
  tabId?: number;
  leafId?: number;
  onActivate: () => void;
};

export function routeAgentNotification({
  source,
  agent,
  kind,
  title,
  body,
  focused,
  visible,
  allowToast,
  tabId = 0,
  leafId = 0,
  onActivate,
}: RouteArgs): void {
  if (!usePreferencesStore.getState().agentNotifications) return;
  if (focused && visible) return;

  useAgentStore.getState().pushNotification({ source, agent, kind, tabId, leafId });

  if (!focused) {
    recordPendingAgentJump(tabId, leafId);
    void osNotify(title, body ?? agent);
    return;
  }
  if (allowToast) {
    showAgentToast({ agent, title, body, onActivate });
  }
}

const JUMP_TTL_MS = 90_000;
let pendingJump: { tabId: number; leafId: number; at: number } | null = null;

/** Remembered target of the last OS notification sent while unfocused. The
 * notification plugin delivers no click events on desktop, so refocusing the
 * window within the ttl consumes this as a best-effort jump target. */
export function recordPendingAgentJump(
  tabId: number,
  leafId: number,
  now: number = Date.now(),
): void {
  pendingJump = { tabId, leafId, at: now };
}

export function consumePendingAgentJump(
  now: number = Date.now(),
): { tabId: number; leafId: number } | null {
  const p = pendingJump;
  pendingJump = null;
  if (!p || now - p.at > JUMP_TTL_MS) return null;
  return { tabId: p.tabId, leafId: p.leafId };
}
