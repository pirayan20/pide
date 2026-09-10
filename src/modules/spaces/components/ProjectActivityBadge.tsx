import { cn } from "@/lib/utils";
import {
  activityLabel,
  activityStatus,
  type ProjectActivity,
} from "@/modules/spaces/lib/projectActivity";

export function ProjectActivityBadge({
  activity,
  className,
}: {
  activity?: ProjectActivity;
  className?: string;
}) {
  const status = activityStatus(activity);
  if (!status) return null;
  return (
    <span
      key={status}
      role="img"
      title={`Coding agents: ${activityLabel(activity)}`}
      aria-label={`Coding agents: ${activityLabel(activity)}`}
      className={cn(
        "pide-pill-in inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-card ring-2 ring-card",
        className,
      )}
    >
      {status === "working" ? (
        <span
          aria-hidden="true"
          className="size-2.5 animate-spin rounded-full border-[1.5px] border-[var(--terminal-ansi-blue)] border-t-transparent motion-reduce:animate-none motion-reduce:border-t-[var(--terminal-ansi-blue)]"
        />
      ) : status === "idle" || status === "finished" ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full bg-[var(--terminal-ansi-green)]",
            status === "idle" && "opacity-60",
            status === "finished" &&
              "ring-1 ring-[var(--terminal-ansi-green)] ring-offset-1 ring-offset-card",
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-3 items-center justify-center rounded-full text-[9px] font-bold text-background",
            status === "error"
              ? "bg-[var(--terminal-ansi-red)]"
              : "bg-[var(--terminal-ansi-yellow)]",
          )}
        >
          !
        </span>
      )}
    </span>
  );
}
