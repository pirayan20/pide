import type { AgentStatus } from "@/modules/agents/lib/types";

export type ProjectActivity = {
  working: number;
  waiting: number;
  idle?: number;
  finished?: number;
  error?: number;
};

const statusPriority = [
  "waiting",
  "error",
  "working",
  "finished",
  "idle",
] as const;

export function sumProjectActivity(
  a: ProjectActivity,
  b?: ProjectActivity,
): ProjectActivity {
  const result = { ...a };
  for (const status of statusPriority) {
    if (b?.[status]) result[status] = (result[status] ?? 0) + b[status];
  }
  return result;
}

export function aggregateProjectActivity(
  tabs: readonly { id: number; projectId: string; kind: string }[],
  sessions: readonly { tabId: number; status: AgentStatus }[],
): Record<string, ProjectActivity> {
  const owners = new Map(
    tabs
      .filter((tab) => tab.kind === "terminal")
      .map((tab) => [tab.id, tab.projectId]),
  );
  const result: Record<string, ProjectActivity> = {};
  for (const session of sessions) {
    const projectId = owners.get(session.tabId);
    if (!projectId) continue;
    const activity = result[projectId] ?? { working: 0, waiting: 0 };
    activity[session.status] = (activity[session.status] ?? 0) + 1;
    result[projectId] = activity;
  }
  return result;
}

export function activityStatus(activity?: ProjectActivity): AgentStatus | null {
  return statusPriority.find((status) => activity?.[status]) ?? null;
}

export function activityLabel(activity?: ProjectActivity): string {
  if (!activityStatus(activity)) return "No detected coding agents";
  return [
    activity?.working ? `${activity.working} working` : "",
    activity?.waiting ? `${activity.waiting} need input` : "",
    activity?.error ? `${activity.error} failed` : "",
    activity?.finished ? `${activity.finished} finished, unread` : "",
    activity?.idle ? `${activity.idle} idle` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function createProjectActivitySelector(
  tabs: readonly { id: number; projectId: string; kind: string }[],
) {
  type Sessions = Record<number, { tabId: number; status: AgentStatus }>;
  let previousSessions: Sessions | undefined;
  let previous: Record<string, ProjectActivity> = {};
  return ({ sessions }: { sessions: Sessions }) => {
    if (sessions === previousSessions) return previous;
    previousSessions = sessions;
    const next = aggregateProjectActivity(tabs, Object.values(sessions));
    const keys = Object.keys(next);
    if (
      keys.length !== Object.keys(previous).length ||
      keys.some((key) =>
        statusPriority.some(
          (status) => next[key][status] !== previous[key]?.[status],
        ),
      )
    )
      previous = next;
    return previous;
  };
}
