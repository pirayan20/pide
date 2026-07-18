import { displayAgent } from "@/modules/agents";
import type { Tab } from "./useTabs";

export type TabAgentContext = { name: string; oscTitle?: string | null };

function folderFromCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

// Shell-set titles (cwd echoes, bare shell names, paths) are noise; only a
// title the agent itself set is worth replacing the tab label with.
function usefulOscTitle(
  title: string | null | undefined,
  cwd: string | undefined,
): string | null {
  const t = title?.trim();
  if (!t) return null;
  if (t === cwd || t === folderFromCwd(cwd)) return null;
  if (t.startsWith("/") || t.startsWith("~")) return null;
  if (/^(zsh|bash|fish|sh|pwsh|powershell|cmd)$/i.test(t)) return null;
  return t;
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then (while a coding agent is active) the
 * agent's own window title or an `<agent> - <folder>` baseline, then the last
 * segment of the cwd. Keeping this pure makes the invariants testable without
 * rendering the bar.
 */
export function labelFor(t: Tab, agent?: TabAgentContext | null): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "render") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.customTitle) return t.customTitle;
  const folder = folderFromCwd(t.cwd);
  if (agent) {
    const osc = usefulOscTitle(agent.oscTitle, t.cwd);
    if (osc) return osc;
    const name = displayAgent(agent.name);
    return folder ? `${name} - ${folder}` : name;
  }
  if (!t.cwd) return t.title;
  return folder ?? "/";
}
