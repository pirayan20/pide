import type { QuotaWindow } from "./types";

export function orderByConstrained(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort((a, b) => b.used_pct - a.used_pct);
}

export function usedLabel(window: QuotaWindow): string {
  return `${Math.round(window.used_pct)}% used ${window.label}`;
}

export function formatReset(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return "";
  const secs = Math.max(0, Math.floor((resetsAt - now) / 1000));
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `Resets in ${d}d ${h}h`;
  if (h > 0) return `Resets in ${h}h ${m}m`;
  return `Resets in ${m}m`;
}

export function formatFreshness(fetchedAt: number, now = Date.now()): string {
  const mins = Math.floor((now - fetchedAt) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `Updated ${hrs}h ago`;
}
