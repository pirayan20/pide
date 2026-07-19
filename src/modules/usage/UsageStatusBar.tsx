import { ProviderChip } from "./ProviderChip";
import { useUsageStore, V1_PROVIDERS } from "./store/usageStore";

export function UsageStatusBar() {
  const providers = useUsageStore((s) => s.providers);
  const visible = providers
    .filter((p) => p.status !== "signed_out")
    .sort(
      (a, b) =>
        V1_PROVIDERS.indexOf(a.provider as (typeof V1_PROVIDERS)[number]) -
        V1_PROVIDERS.indexOf(b.provider as (typeof V1_PROVIDERS)[number]),
    );
  if (visible.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-4">
      {visible.map((p) => (
        <ProviderChip key={p.provider} usage={p} />
      ))}
    </div>
  );
}
