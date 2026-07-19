import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { orderByConstrained, usedLabel } from "./lib/format";
import type { ProviderUsage } from "./lib/types";
import { useUsageStore } from "./store/usageStore";

function barColor(status: ProviderUsage["status"]): string {
  if (status === "limited") return "bg-amber-500";
  if (status === "stale") return "bg-muted-foreground/40";
  return "bg-emerald-500";
}

export function ProviderChip({ usage }: { usage: ProviderUsage }) {
  const refresh = useUsageStore((s) => s.refresh);
  const ordered = orderByConstrained(usage.windows);
  const top = ordered[0];

  const text =
    usage.status === "unavailable"
      ? "Usage unavailable"
      : usage.status === "auth_expired"
        ? "Sign in again"
        : usage.status === "loading"
          ? "Loading…"
          : usage.status === "limited"
            ? "Limited"
            : ordered.map(usedLabel).join(" · ");

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px]">
      <AgentIcon agent={usage.provider} size={12} />
      {top ? (
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted">
          <span
            className={`absolute inset-y-0 left-0 ${barColor(usage.status)}`}
            style={{ width: `${Math.min(100, Math.max(0, top.used_pct))}%` }}
          />
        </span>
      ) : null}
      <span className="whitespace-nowrap text-muted-foreground">{text}</span>
      <button
        type="button"
        aria-label={`Refresh ${usage.provider} usage`}
        className="text-muted-foreground/70 hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          void refresh(usage.provider);
        }}
      >
        <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={2} />
      </button>
    </span>
  );
}
