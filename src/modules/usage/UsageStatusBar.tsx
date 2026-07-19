import { ProviderChip } from "./ProviderChip";
import { useUsageStore } from "./store/usageStore";

export function UsageStatusBar() {
  const providers = useUsageStore((s) => s.providers);
  const visible = providers.filter((p) => p.status !== "signed_out");
  if (visible.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-4">
      {visible.map((p) => (
        <ProviderChip key={p.provider} usage={p} />
      ))}
    </div>
  );
}
