export type AgentStatus = "idle" | "working" | "waiting" | "finished" | "error";

export type AgentSignalKind =
  | "started"
  | "working"
  | "idle"
  | "attention"
  | "finished"
  | "error"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
  /** Set on title-derived signals emitted by the frontend tracker; absent on
   * Rust detector signals, whose explicit markers are authoritative. */
  synthetic?: boolean;
  /** Initial status for synthetic started signals (default "idle"). */
  status?: AgentStatus;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
  /** True once an explicit hook marker (OSC 777) drove this session; title
   * heuristics then stop steering its status. */
  hookDriven: boolean;
  /** "Space/Project" of the owning tab, shown on notification surfaces. */
  context: string | null;
};
