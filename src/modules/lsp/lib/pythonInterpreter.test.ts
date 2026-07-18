import { describe, expect, it } from "vitest";
import {
  buildPythonSettings,
  chooseInterpreter,
  interpreterCandidates,
  interpreterLabel,
} from "./pythonInterpreter";

describe("interpreterCandidates", () => {
  it("returns posix venv paths", () => {
    expect(interpreterCandidates("/repo", false)).toEqual([
      "/repo/.venv/bin/python",
      "/repo/venv/bin/python",
    ]);
  });
  it("returns windows venv paths", () => {
    expect(interpreterCandidates("C:\\repo", true)).toEqual([
      "C:\\repo\\.venv\\Scripts\\python.exe",
      "C:\\repo\\venv\\Scripts\\python.exe",
    ]);
  });
});

describe("interpreterLabel", () => {
  it("labels a .venv path", () => {
    expect(interpreterLabel("/repo/.venv/bin/python")).toBe(".venv");
  });
  it("labels a venv path", () => {
    expect(interpreterLabel("/repo/venv/bin/python")).toBe("venv");
  });
  it("falls back to the basename", () => {
    expect(interpreterLabel("/usr/bin/python3")).toBe("python3");
  });
});

describe("chooseInterpreter", () => {
  it("prefers override, then venv, then PATH", () => {
    expect(
      chooseInterpreter({ override: "/o", existingVenv: "/v", pathPython: "/p" }),
    ).toBe("/o");
    expect(
      chooseInterpreter({ override: null, existingVenv: "/v", pathPython: "/p" }),
    ).toBe("/v");
    expect(
      chooseInterpreter({ override: null, existingVenv: null, pathPython: "/p" }),
    ).toBe("/p");
    expect(
      chooseInterpreter({ override: null, existingVenv: null, pathPython: null }),
    ).toBeNull();
  });
});

describe("buildPythonSettings", () => {
  it("sets pythonPath under python and python.analysis", () => {
    const s = buildPythonSettings("/repo/.venv/bin/python");
    expect((s.python as { pythonPath: string }).pythonPath).toBe(
      "/repo/.venv/bin/python",
    );
    expect(s["python.analysis"]).toMatchObject({
      useLibraryCodeForTypes: true,
      autoSearchPaths: true,
    });
  });
});
