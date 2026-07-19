import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ProviderUsage } from "../lib/types";

export const V1_PROVIDERS = ["claude", "codex"] as const;
export const STALE_AFTER_MS = 15 * 60_000;
export const BACKGROUND_INTERVAL_MS = 5 * 60_000;

type UsageStoreState = {
  providers: ProviderUsage[];
  refreshAll: () => Promise<void>;
  refresh: (provider: string) => Promise<void>;
  connect: (provider: string) => Promise<void>;
  disconnect: (provider: string) => Promise<void>;
  startAutoRefresh: () => () => void;
};

// Client-side staleness overlay: mark Ok/Limited snapshots stale once old.
export function withStaleness(
  p: ProviderUsage,
  now = Date.now(),
): ProviderUsage {
  const fresh = now - p.fetched_at < STALE_AFTER_MS;
  if (fresh || p.status === "signed_out" || p.status === "loading") return p;
  if (p.status === "ok" || p.status === "limited")
    return { ...p, status: "stale" };
  return p;
}

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  providers: [],

  refreshAll: async () => {
    const snap = await invoke<ProviderUsage[]>("usage_snapshot").catch(
      () => [],
    );
    set({ providers: snap.map((p) => withStaleness(p)) });
  },

  refresh: async (provider) => {
    const updated = await invoke<ProviderUsage>("usage_refresh", {
      provider,
    }).catch(() => null);
    if (!updated) return;
    set((s) => ({
      providers: mergeProvider(s.providers, withStaleness(updated)),
    }));
  },

  connect: async (provider) => {
    const updated = await invoke<ProviderUsage>("usage_connect", {
      provider,
    }).catch(() => null);
    if (!updated) return;
    set((s) => ({
      providers: mergeProvider(s.providers, withStaleness(updated)),
    }));
  },

  disconnect: async (provider) => {
    await invoke("usage_disconnect", { provider }).catch(() => {});
    set((s) => ({
      providers: s.providers.filter((p) => p.provider !== provider),
    }));
  },

  startAutoRefresh: () => {
    void get().refreshAll();
    const id = setInterval(() => {
      for (const p of get().providers) {
        if (p.status !== "signed_out") void get().refresh(p.provider);
      }
    }, BACKGROUND_INTERVAL_MS);
    return () => clearInterval(id);
  },
}));

function mergeProvider(
  list: ProviderUsage[],
  next: ProviderUsage,
): ProviderUsage[] {
  const rest = list.filter((p) => p.provider !== next.provider);
  return [...rest, next];
}
