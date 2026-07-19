import { describe, expect, it } from "vitest";
import { formatFreshness, formatReset, orderByConstrained, usedLabel } from "./format";
import type { QuotaWindow } from "./types";

const w = (label: string, used: number, resets_at: number | null = null): QuotaWindow => ({
  label,
  used_pct: used,
  resets_at,
});

describe("orderByConstrained", () => {
  it("puts the highest-used window first", () => {
    const out = orderByConstrained([w("5h", 38), w("Weekly", 4), w("Fable", 2)]);
    expect(out.map((x) => x.label)).toEqual(["5h", "Weekly", "Fable"]);
  });
});

describe("usedLabel", () => {
  it("renders percent used with window label", () => {
    expect(usedLabel(w("5h", 38))).toBe("38% used 5h");
  });
});

describe("formatReset", () => {
  it("formats days and hours", () => {
    const now = 1_000_000_000_000;
    const resets = now + (5 * 24 + 21) * 3600_000;
    expect(formatReset(resets, now)).toBe("Resets in 5d 21h");
  });
  it("returns empty for null", () => {
    expect(formatReset(null, 0)).toBe("");
  });
});

describe("formatFreshness", () => {
  it("says just now under a minute", () => {
    expect(formatFreshness(1_000, 1_030_000 - 1_029_000 + 1_000)).toBe("Updated just now");
  });
  it("says minutes ago", () => {
    const now = 1_000_000;
    expect(formatFreshness(now - 3 * 60_000, now)).toBe("Updated 3m ago");
  });
});
