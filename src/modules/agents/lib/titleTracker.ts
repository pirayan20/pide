import type { TitleAgentStatus } from "./titleStatus";

export function sessionStatusFor(
  status: TitleAgentStatus,
): "working" | "waiting" | "idle" {
  return status === "permission" ? "waiting" : status;
}

export type TitleTransitionEvent =
  | { kind: "started"; status: "working" | "waiting" | "idle" }
  | { kind: "working" }
  | { kind: "attention" }
  | { kind: "finished" }
  | { kind: "idle" };

/** Events a title status change produces for a leaf. Mirrors Orca's title
 * tracker: only working -> idle is a completion, entering permission always
 * asks for attention, and a null title never steers an existing session
 * (agents repaint transient titles mid-turn). */
export function titleTransitionEvents(
  last: TitleAgentStatus | null,
  next: TitleAgentStatus | null,
  hasSession: boolean,
): TitleTransitionEvent[] {
  if (next === null || next === last) return [];
  if (!hasSession) {
    return [{ kind: "started", status: sessionStatusFor(next) }];
  }
  if (next === "working") return [{ kind: "working" }];
  if (next === "permission") return [{ kind: "attention" }];
  return last === "working" ? [{ kind: "finished" }] : [{ kind: "idle" }];
}
