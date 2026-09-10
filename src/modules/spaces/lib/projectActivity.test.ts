import { describe, expect, it } from "vitest";
import {
  activityStatus,
  aggregateProjectActivity,
  createProjectActivitySelector,
} from "./projectActivity";

const tabs = [
  { id: 1, projectId: "p1", kind: "terminal" },
  { id: 2, projectId: "p2", kind: "terminal" },
  { id: 3, projectId: "p1", kind: "editor" },
];

describe("project agent activity", () => {
  it("aggregates split agents by owning project and prioritizes waiting", () => {
    const result = aggregateProjectActivity(tabs, [
      { tabId: 1, status: "working" },
      { tabId: 1, status: "waiting" },
      { tabId: 2, status: "working" },
    ]);
    expect(result).toEqual({
      p1: { working: 1, waiting: 1 },
      p2: { working: 1, waiting: 0 },
    });
    expect(activityStatus(result.p1)).toBe("waiting");
    expect(activityStatus(result.p2)).toBe("working");
  });
  it("ignores removed tabs and non-terminal tabs", () => {
    expect(
      aggregateProjectActivity(tabs, [
        { tabId: 99, status: "working" },
        { tabId: 3, status: "waiting" },
      ]),
    ).toEqual({});
  });
  it("removes activity when agents exit without treating ordinary terminals as agents", () => {
    expect(aggregateProjectActivity(tabs, [])).toEqual({});
    expect(activityStatus(undefined)).toBeNull();
    expect(activityStatus({ working: 0, waiting: 0 })).toBeNull();
  });
});

it("keeps the status snapshot stable across heartbeat updates", () => {
  const select = createProjectActivitySelector(tabs);
  const first = select({ sessions: { 1: { tabId: 1, status: "working" } } });
  expect(select({ sessions: { 1: { tabId: 1, status: "working" } } })).toBe(
    first,
  );
  expect(select({ sessions: { 1: { tabId: 1, status: "waiting" } } })).not.toBe(
    first,
  );
  expect(select({ sessions: {} })).toEqual({});
});

it("prioritizes input, errors, work, unread completion, then idle across projects", () => {
  const result = aggregateProjectActivity(tabs, [
    { tabId: 1, status: "idle" },
    { tabId: 1, status: "finished" },
    { tabId: 2, status: "error" },
  ]);
  expect(activityStatus(result.p1)).toBe("finished");
  expect(activityStatus(result.p2)).toBe("error");
  expect(activityStatus({ working: 1, waiting: 0, finished: 1 })).toBe(
    "working",
  );
  expect(activityStatus({ working: 1, waiting: 0, error: 1 })).toBe("error");
  expect(activityStatus({ working: 1, waiting: 1, error: 1 })).toBe("waiting");
  expect(activityStatus({ working: 0, waiting: 0, idle: 1 })).toBe("idle");
});
