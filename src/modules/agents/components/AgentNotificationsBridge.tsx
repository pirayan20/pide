import type { Tab } from "@/modules/tabs";
import { hasLeaf, leafIdForPty } from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { displayAgent } from "../lib/format";
import { consumePendingAgentJump, routeAgentNotification } from "../lib/route";
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

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string; project: string | null } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      const parts = (t.cwd ?? "").split(/[\\/]/).filter(Boolean);
      return {
        tabId: t.id,
        title: t.title,
        project: parts.length ? parts[parts.length - 1] : null,
      };
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
  const info = tabInfo(ctx.tabs, session.leafId);
  const name = displayAgent(session.agent);
  const heading = `${name} ${HEADINGS[kind]}`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: info?.project ?? info?.title,
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
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      return;
    }
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      return;
    }
    case "error": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "error", ctx);
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
    listen<AgentSignal>("terax:agent-signal", (e) =>
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

  return null;
}
