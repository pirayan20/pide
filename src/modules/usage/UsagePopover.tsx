import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  formatFreshness,
  formatReset,
  orderByConstrained,
  usedLabel,
} from "./lib/format";
import type { ProviderUsage } from "./lib/types";
import { useUsageStore } from "./store/usageStore";

export function UsagePopover({ usage }: { usage: ProviderUsage }) {
  const logout = useUsageStore((s) => s.logout);
  const name =
    usage.provider === "claude"
      ? "Claude"
      : usage.provider === "codex"
        ? "Codex"
        : usage.provider;
  return (
    <div className="w-64 text-[11px]">
      <div className="mb-2 flex items-center gap-2">
        <AgentIcon agent={usage.provider} size={16} />
        <div>
          <div className="font-medium capitalize">{name}</div>
          <div className="text-muted-foreground">
            {formatFreshness(usage.fetched_at)}
          </div>
        </div>
      </div>

      {usage.status === "unavailable" ? (
        <p className="py-2 text-muted-foreground">
          Usage unavailable for this provider.
        </p>
      ) : usage.status === "auth_expired" ? (
        <p className="py-2 text-muted-foreground">
          Login expired — sign in again in the CLI.
        </p>
      ) : (
        <div className="space-y-2 border-t border-border/60 py-2">
          {orderByConstrained(usage.windows).map((w) => (
            <div key={w.label}>
              <div className="flex items-center justify-between">
                <span>{usedLabel(w)}</span>
                <span className="text-muted-foreground">
                  {formatReset(w.resets_at)}
                </span>
              </div>
              <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-emerald-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, w.used_pct))}%`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border/60 pt-2">
        {usage.plan ? (
          <div className="capitalize text-muted-foreground">
            Plan: {usage.plan}
          </div>
        ) : null}
        {usage.account ? (
          <div className="text-muted-foreground">{usage.account}</div>
        ) : null}
        <button
          type="button"
          className="mt-1 text-muted-foreground hover:text-foreground"
          onClick={() => void logout(usage.provider)}
        >
          Disconnect
        </button>
        <button
          type="button"
          className="mt-1 block text-muted-foreground hover:text-foreground"
          onClick={() => void openSettingsWindow("accounts")}
        >
          Manage Accounts…
        </button>
      </div>
    </div>
  );
}
