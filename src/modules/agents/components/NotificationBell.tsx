import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Notification01Icon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { AgentIcon } from "../lib/agentIcon";
import { displayAgent } from "../lib/format";
import type { AgentStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";
import { showAgentToast } from "./AgentToast";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
};

function StatusRow({
  agent,
  status,
  context,
  onClick,
}: {
  agent: string;
  status: AgentStatus;
  context: string | null;
  onClick: () => void;
}) {
  const waiting = status === "waiting";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={agent}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {displayAgent(agent)}
        {context ? (
          <span className="text-xs text-muted-foreground"> {context}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          waiting ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {waiting ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        {status === "finished" ? "finished, unread" : status}
      </span>
    </button>
  );
}

const HOOK_AGENTS = ["claude", "codex", "gemini", "pi", "omp"] as const;

function HookAgentRow({
  id,
  label,
  ready,
  installing,
  onEnable,
}: {
  id: string;
  label: string;
  ready: boolean;
  installing: boolean;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <AgentIcon
        agent={id}
        size={14}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-[12px] text-muted-foreground">
        {label}
      </span>
      {ready ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={13}
            strokeWidth={1.75}
          />
          enabled
        </span>
      ) : (
        <button
          type="button"
          onClick={onEnable}
          disabled={installing}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {installing ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={12}
              strokeWidth={1.75}
              className="animate-spin"
            />
          ) : null}
          {installing ? "Enabling" : "Enable"}
        </button>
      )}
    </div>
  );
}

export function NotificationBell({ onActivate }: Props) {
  const [open, setOpen] = useState(false);
  const [hooks, setHooks] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const activeCount = active.length;
  const badge = active.filter((s) => ["waiting", "finished", "error"].includes(s.status)).length;
  const enabledCount = HOOK_AGENTS.filter((id) => hooks[id] === true).length;

  const refreshHooks = () => {
    for (const id of HOOK_AGENTS) {
      invoke<boolean>("agent_hooks_status", { agent: id })
        .then((ok) => setHooks((h) => ({ ...h, [id]: ok })))
        .catch(() => setHooks((h) => ({ ...h, [id]: false })));
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refreshHooks();
  };

  const enableHooks = async (id: string) => {
    setInstalling(id);
    try {
      await invoke("agent_enable_hooks", { agent: id });
      setHooks((h) => ({ ...h, [id]: true }));
    } catch (e) {
      setHooks((h) => ({ ...h, [id]: false }));
      showAgentToast({
        agent: id,
        title: `${displayAgent(id)} alerts setup failed`,
        body: String(e),
        onActivate: () => {},
      });
    } finally {
      setInstalling(null);
    }
  };

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Agent notifications"
        >
          <HugeiconsIcon
            icon={Notification01Icon}
            size={16}
            strokeWidth={1.75}
          />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden p-0 gap-0.5"
      >
        <div className="flex h-10 items-center gap-2 px-3 pt-0.5">
          <span className="flex gap-1 text-[13px] text-foreground">
            Notifications
          </span>
          <div className="ml-auto flex items-center gap-2">
            {activeCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {activeCount} active
              </span>
            ) : null}
          </div>
        </div>

        {activeCount === 0 ? (
          <div className="border-t border-border/60 px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
            No coding agent activity yet.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border-t border-border/60 p-1">
            {active.map((s) => (
              <StatusRow
                key={s.leafId}
                agent={s.agent}
                status={s.status}
                context={s.context}
                onClick={() => activate(s.tabId, s.leafId)}
              />
            ))}
          </div>
        )}

        <div className="border-t border-border/60 p-1">
          <button
            type="button"
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Notification03Icon}
              size={11}
              strokeWidth={2}
            />
            Agent alerts
            <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
              {enabledCount > 0 ? (
                <span className="text-[10px] text-muted-foreground/60">
                  {enabledCount} on
                </span>
              ) : null}
              <HugeiconsIcon
                icon={alertsOpen ? ArrowUp01Icon : ArrowDown01Icon}
                size={13}
                strokeWidth={2}
              />
            </span>
          </button>
          {alertsOpen
            ? HOOK_AGENTS.map((id) => (
                <HookAgentRow
                  key={id}
                  id={id}
                  label={displayAgent(id)}
                  ready={hooks[id] === true}
                  installing={installing === id}
                  onEnable={() => enableHooks(id)}
                />
              ))
            : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
