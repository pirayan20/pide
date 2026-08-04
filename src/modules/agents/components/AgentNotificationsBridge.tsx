import { useSpaces } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import {
  hasLeaf,
  leafCommandRunning,
  leafIdForPty,
  ptyIdForLeaf,
  subscribeLeafCommandState,
  useAgentActivityStore,
  useLeafTitleStore,
} from "@/modules/terminal";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { displayAgent } from "../lib/format";
import { initKeepAwake } from "../lib/keepAwake";
import { consumePendingAgentJump, routeAgentNotification } from "../lib/route";
import {
  agentLabelFromTitle,
  agentNameFromCommand,
  detectAgentStatusFromTitle,
  type TitleAgentStatus,
} from "../lib/titleStatus";
import { titleTransitionEvents } from "../lib/titleTracker";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number | null;
  focused: boolean;
  onActivate: Activate;
};

/** "Space/Project" of the tab's project, else the cwd basename. */
function tabContext(tab: Extract<Tab, { kind: "terminal" }>): string | null {
  const { spaces, projects } = useSpaces.getState();
  const project = projects.find((p) => p.id === tab.projectId);
  if (project) {
    const space = spaces.find((s) => s.id === project.spaceId);
    return space ? `${space.name}/${project.name}` : project.name;
  }
  const parts = (tab.cwd ?? "").split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string; context: string | null } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title, context: tabContext(t) };
    }
  }
  return null;
}

const HEADINGS: Record<"attention" | "finished" | "error", string> = {
  attention: "needs your input",
  finished: "finished",
  error: "failed",
};

function route(
  session: AgentSession,
  kind: "attention" | "finished" | "error",
  ctx: Ctx,
): void {
  const name = displayAgent(session.agent);
  const heading = `${name} ${HEADINGS[kind]}`;
  const context =
    session.context ?? tabInfo(ctx.tabs, session.leafId)?.context ?? null;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: context ?? undefined,
    context,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    // Stop fires every turn, so finished only updates the bell; attention and
    // error toast.
    allowToast: kind !== "finished",
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent", info.context);
      if (sig.status === "waiting") store.setStatus(leafId, "waiting");
      return;
    }
    case "working":
      // Explicit 777 markers outrank title heuristics from here on. OSC 9
      // attention is excluded: a hook-less agent that rings the bell once must
      // keep its title-driven status.
      if (!sig.synthetic) store.markHookDriven(leafId);
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished":
    case "error": {
      if (!sig.synthetic) store.markHookDriven(leafId);
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, sig.kind, ctx);
      return;
    }
    case "exited":
      store.finish(leafId);
      return;
  }
}

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
}: {
  tabs: Tab[];
  activeId: number | null;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ tabs, activeId, focused, onActivate });
  ctxRef.current = { tabs, activeId, focused, onActivate };

  const prevFocused = useRef(focused);
  useEffect(() => {
    if (focused && !prevFocused.current) {
      const target = consumePendingAgentJump();
      if (target) onActivate(target.tabId, target.leafId);
    }
    prevFocused.current = focused;
  }, [focused, onActivate]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("pide:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Title-derived tracking: OSC 0/2 titles are the one status channel every
  // agent CLI emits, so agents work with no hooks and no prior registration.
  // Synthetic signals reuse the same pide:agent-signal pipeline as the Rust
  // detector, so the bell, tab badges, and keep-awake all see one stream.
  useEffect(() => {
    const last = new Map<number, TitleAgentStatus>();
    const lastCommand = new Map<number, string>();
    const trackedPty = new Map<number, number>();

    const emitSignal = (ptyId: number, sig: Omit<AgentSignal, "id">) => {
      emit("pide:agent-signal", { id: ptyId, ...sig }).catch(() => {});
    };

    const onTitle = (leafId: number, title: string) => {
      const prev = last.get(leafId) ?? null;
      const next = detectAgentStatusFromTitle(title);
      if (next !== null) last.set(leafId, next);
      const session = useAgentStore.getState().sessions[leafId];
      if (session?.hookDriven) return;
      const events = titleTransitionEvents(prev, next, session !== undefined);
      if (events.length === 0) return;
      const ptyId = ptyIdForLeaf(leafId);
      if (ptyId === null) return;
      for (const ev of events) {
        if (ev.kind === "started") {
          // A title without a live foreground command is a stale leftover.
          if (!leafCommandRunning(leafId)) continue;
          trackedPty.set(leafId, ptyId);
          const agent =
            agentLabelFromTitle(title) ??
            agentNameFromCommand(lastCommand.get(leafId) ?? "") ??
            "agent";
          emitSignal(ptyId, {
            kind: "started",
            agent,
            synthetic: true,
            status: ev.status,
          });
        } else {
          emitSignal(ptyId, { kind: ev.kind, agent: null, synthetic: true });
        }
      }
    };

    // Leaf disposed with its title: the pty binding is already gone, so drop
    // the session and its badge entry directly instead of via a signal.
    const onTitleRemoved = (leafId: number) => {
      last.delete(leafId);
      lastCommand.delete(leafId);
      const ptyId = trackedPty.get(leafId);
      trackedPty.delete(leafId);
      if (!useAgentStore.getState().sessions[leafId]) return;
      useAgentStore.getState().finish(leafId);
      if (ptyId !== undefined) useAgentActivityStore.getState().clear(ptyId);
    };

    let prevTitles = useLeafTitleStore.getState().titles;
    const unsubTitles = useLeafTitleStore.subscribe((state) => {
      const titles = state.titles;
      if (titles === prevTitles) return;
      for (const key of Object.keys(titles)) {
        const leafId = Number(key);
        if (prevTitles[leafId] !== titles[leafId]) {
          onTitle(leafId, titles[leafId]);
        }
      }
      for (const key of Object.keys(prevTitles)) {
        if (!(key in titles)) onTitleRemoved(Number(key));
      }
      prevTitles = titles;
    });

    const unsubCommands = subscribeLeafCommandState(
      (leafId, running, command) => {
        if (running) {
          if (command) lastCommand.set(leafId, command);
          return;
        }
        // Foreground command ended: whatever agent ran on this leaf is gone.
        last.delete(leafId);
        const ptyId = trackedPty.get(leafId) ?? ptyIdForLeaf(leafId);
        trackedPty.delete(leafId);
        if (!useAgentStore.getState().sessions[leafId]) return;
        if (ptyId !== null) {
          emitSignal(ptyId, { kind: "exited", agent: null, synthetic: true });
        } else {
          useAgentStore.getState().finish(leafId);
        }
      },
    );

    const unsubKeepAwake = initKeepAwake();

    return () => {
      unsubTitles();
      unsubCommands();
      unsubKeepAwake();
    };
  }, []);

  return null;
}
