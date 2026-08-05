import { beforeEach, describe, expect, it, vi } from "vitest";

const terminal = vi.hoisted(() => ({
  agents: new Map<number, string>(),
  leaves: new Map<number, number>(),
}));

vi.mock("@/modules/terminal", () => ({
  agentForPty: (ptyId: number) => terminal.agents.get(ptyId) ?? null,
  hasLeaf: () => true,
  leafCommandRunning: () => true,
  leafIdForPty: (ptyId: number) => terminal.leaves.get(ptyId) ?? null,
  ptyIdForLeaf: () => null,
  subscribeLeafCommandState: () => () => {},
  useAgentActivityStore: { getState: () => ({ clear: () => {} }) },
  useLeafTitleStore: {
    getState: () => ({ titles: {} }),
    subscribe: () => () => {},
  },
}));

vi.mock("@/modules/spaces", () => ({
  useSpaces: { getState: () => ({ spaces: [], projects: [] }) },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));

const routed = vi.hoisted(() => ({
  calls: [] as Array<{ agent: string; title: string }>,
}));

vi.mock("../lib/route", () => ({
  consumePendingAgentJump: () => null,
  routeAgentNotification: (args: { agent: string; title: string }) => {
    routed.calls.push({ agent: args.agent, title: args.title });
  },
}));

vi.mock("../lib/keepAwake", () => ({ initKeepAwake: () => () => {} }));

import type { Tab } from "@/modules/tabs";
import { useAgentStore } from "../store/agentStore";
import { handleSignal } from "./AgentNotificationsBridge";

const tabs = [
  {
    kind: "terminal",
    id: 5,
    title: "term",
    cwd: "/x/proj",
    private: false,
    paneTree: 0,
  },
] as unknown as Tab[];

const ctx = { tabs, activeId: null, focused: false, onActivate: () => {} };

describe("handleSignal session revival after webview reload", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessions: {} });
    terminal.agents.clear();
    terminal.leaves.clear();
    routed.calls.length = 0;
  });

  it("rebuilds the session from seeded identity and routes the notification", () => {
    terminal.agents.set(1, "pi");
    terminal.leaves.set(1, 10);
    handleSignal({ id: 1, kind: "finished", agent: null }, ctx);
    const session = useAgentStore.getState().sessions[10];
    expect(session).toMatchObject({ agent: "pi", tabId: 5, status: "waiting" });
    expect(routed.calls).toEqual([{ agent: "pi", title: "Pi finished" }]);
  });

  it("ignores signals for ptys with no seeded identity", () => {
    terminal.leaves.set(1, 10);
    handleSignal({ id: 1, kind: "working", agent: null }, ctx);
    expect(useAgentStore.getState().sessions[10]).toBeUndefined();
  });

  it("never clobbers a live session", () => {
    terminal.agents.set(1, "pi");
    terminal.leaves.set(1, 10);
    useAgentStore.getState().start(10, 5, "claude", null);
    handleSignal({ id: 1, kind: "working", agent: null }, ctx);
    expect(useAgentStore.getState().sessions[10]?.agent).toBe("claude");
  });
});
