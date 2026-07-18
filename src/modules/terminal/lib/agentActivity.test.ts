import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateAgentPhases,
  phaseForSignal,
  pickTabAgent,
  useAgentActivityStore,
} from "./agentActivity";

describe("phaseForSignal", () => {
  it("maps lifecycle kinds to phases", () => {
    expect(phaseForSignal("started")).toBe("working");
    expect(phaseForSignal("working")).toBe("working");
    expect(phaseForSignal("attention")).toBe("attention");
    expect(phaseForSignal("error")).toBe("attention");
    expect(phaseForSignal("finished")).toBe("finished");
    expect(phaseForSignal("exited")).toBe("exited");
  });

  it("ignores unknown kinds", () => {
    expect(phaseForSignal("bogus")).toBeNull();
    expect(phaseForSignal("")).toBeNull();
  });
});

describe("aggregateAgentPhases", () => {
  it("returns null top for no matching ptys", () => {
    expect(aggregateAgentPhases({}, [])).toEqual({ top: null, count: 0 });
    expect(aggregateAgentPhases({ 1: "idle" }, [1])).toEqual({
      top: null,
      count: 0,
    });
  });

  it("counts only agents in the winning phase", () => {
    const phases = { 1: "working", 2: "working", 3: "attention" } as const;
    // attention outranks working; count reflects the single attention agent.
    expect(aggregateAgentPhases(phases, [1, 2, 3])).toEqual({
      top: "attention",
      count: 1,
    });
  });

  it("orders attention > working > finished", () => {
    expect(
      aggregateAgentPhases({ 1: "working", 2: "finished" }, [1, 2]),
    ).toEqual({ top: "working", count: 1 });
    expect(aggregateAgentPhases({ 1: "finished", 2: "finished" }, [1, 2])).toEqual(
      { top: "finished", count: 2 },
    );
  });

  it("only considers the given ptyIds", () => {
    const phases = { 1: "attention", 2: "working" } as const;
    expect(aggregateAgentPhases(phases, [2])).toEqual({
      top: "working",
      count: 1,
    });
  });
});

describe("useAgentActivityStore", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, agents: {} }));

  it("keeps a stable reference when the phase is unchanged", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const first = useAgentActivityStore.getState().phases;
    setPhase(1, "working");
    // No churn on repeated identical signals, so subscribers do not re-render.
    expect(useAgentActivityStore.getState().phases).toBe(first);
  });

  it("drops a pty on clear", () => {
    const { setPhase, clear } = useAgentActivityStore.getState();
    setPhase(1, "attention");
    clear(1);
    expect(1 in useAgentActivityStore.getState().phases).toBe(false);
  });
});

describe("pickTabAgent", () => {
  it("returns null when no pty has an agent", () => {
    expect(pickTabAgent({}, {}, [[10, 1]])).toBeNull();
  });

  it("returns the agent of the highest-severity phase", () => {
    const phases = { 1: "working", 2: "attention" } as const;
    const agents = { 1: "claude", 2: "pi" };
    expect(
      pickTabAgent(phases, agents, [
        [10, 1],
        [11, 2],
      ]),
    ).toEqual({ agent: "pi", leafId: 11 });
  });

  it("keeps an idle agent visible until it exits", () => {
    expect(pickTabAgent({ 1: "idle" }, { 1: "codex" }, [[10, 1]])).toEqual({
      agent: "codex",
      leafId: 10,
    });
  });

  it("ignores ptys with a phase but no recorded agent", () => {
    expect(pickTabAgent({ 1: "working" }, {}, [[10, 1]])).toBeNull();
  });
});

describe("agent name tracking", () => {
  beforeEach(() =>
    useAgentActivityStore.setState({ phases: {}, agents: {} }),
  );

  it("start records phase and agent; clear drops both", () => {
    const s = useAgentActivityStore.getState();
    s.start(1, "pi");
    expect(useAgentActivityStore.getState().phases[1]).toBe("working");
    expect(useAgentActivityStore.getState().agents[1]).toBe("pi");
    useAgentActivityStore.getState().clear(1);
    expect(useAgentActivityStore.getState().phases[1]).toBeUndefined();
    expect(useAgentActivityStore.getState().agents[1]).toBeUndefined();
  });
});
