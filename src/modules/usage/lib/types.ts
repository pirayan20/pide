export type UsageStatus =
  | "signed_out"
  | "loading"
  | "ok"
  | "limited"
  | "stale"
  | "unavailable"
  | "auth_expired";

export type QuotaWindow = {
  label: string;
  used_pct: number;
  resets_at: number | null;
};

export type ProviderUsage = {
  provider: string;
  status: UsageStatus;
  account: string | null;
  plan: string | null;
  windows: QuotaWindow[];
  fetched_at: number;
};
