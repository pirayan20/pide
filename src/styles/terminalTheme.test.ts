import { describe, expect, it, vi } from "vitest";
import { buildTerminalTheme } from "@/styles/terminalTheme";

vi.mock("@/styles/tokens", () => ({
  readTerminalTokens: () => ({
    background: "#0a0a0a",
    foreground: "#d1d5da",
    cursor: "#79b8ff",
    cursorAccent: "#0a0a0a",
    selection: "#04428966",
    ansiRed: "#ea4a5a",
  }),
}));

describe("terminal window transparency", () => {
  it("removes only the default background, keeping text, cursor, selection and ANSI colors intact", () => {
    const opaque = buildTerminalTheme(false);
    const transparent = buildTerminalTheme(true);
    expect(opaque.background).toBe("#0a0a0a");
    expect(transparent).toEqual({ ...opaque, background: "#00000000" });
    expect(transparent.red).toBe("#ea4a5a");
    expect(buildTerminalTheme(false)).toEqual(opaque);
  });
});
