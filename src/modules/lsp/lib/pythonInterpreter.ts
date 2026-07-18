import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { create } from "zustand";
import { detectBinary } from "./detect";

export type InterpreterOption = { path: string; label: string };

export function interpreterCandidates(
  root: string,
  isWindows = IS_WINDOWS,
): string[] {
  const rel = isWindows
    ? ["\\.venv\\Scripts\\python.exe", "\\venv\\Scripts\\python.exe"]
    : ["/.venv/bin/python", "/venv/bin/python"];
  return rel.map((r) => `${root}${r}`);
}

export function interpreterLabel(path: string): string {
  const p = path.replace(/\\/g, "/");
  if (p.includes("/.venv/")) return ".venv";
  if (p.includes("/venv/")) return "venv";
  const parts = p.split("/");
  return parts[parts.length - 1] || path;
}

export function chooseInterpreter(o: {
  override: string | null;
  existingVenv: string | null;
  pathPython: string | null;
}): string | null {
  return o.override ?? o.existingVenv ?? o.pathPython ?? null;
}

export function buildPythonSettings(
  interpreter: string,
): Record<string, unknown> {
  const analysis = { useLibraryCodeForTypes: true, autoSearchPaths: true };
  return {
    python: { pythonPath: interpreter, analysis },
    "python.analysis": analysis,
  };
}

async function pathIsFile(path: string): Promise<boolean> {
  return native
    .fileStat(path)
    .then((s) => s.kind === "file" || s.kind === "symlink")
    .catch(() => false);
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await pathIsFile(p)) return p;
  }
  return null;
}

// $VIRTUAL_ENV is not probed directly (the app process rarely inherits the
// workspace shell's env). An activated venv surfaces through the PATH fallback
// below, since detectBinary resolves `python3` against the launch environment.
export async function resolvePythonInterpreter(
  root: string,
): Promise<string | null> {
  const override = usePreferencesStore.getState().pythonInterpreters[root] ?? null;
  if (override) return override;
  const existingVenv = await firstExisting(interpreterCandidates(root));
  const pathPython = existingVenv
    ? null
    : ((await detectBinary("python3")) ?? (await detectBinary("python")));
  return chooseInterpreter({ override, existingVenv, pathPython });
}

export async function discoverInterpreters(
  root: string,
): Promise<InterpreterOption[]> {
  const out: InterpreterOption[] = [];
  const seen = new Set<string>();
  const add = (path: string | null) => {
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push({ path, label: interpreterLabel(path) });
    }
  };
  const [venv, venv2] = interpreterCandidates(root);
  add(await firstExisting([venv]));
  add(await firstExisting([venv2]));
  add(await detectBinary("python3"));
  add(await detectBinary("python"));
  return out;
}

export async function pythonWorkspaceSettings(
  root: string,
): Promise<Record<string, unknown> | undefined> {
  const interpreter = await resolvePythonInterpreter(root);
  return interpreter ? buildPythonSettings(interpreter) : undefined;
}

type PyState = {
  byRoot: Record<string, string | null>;
  resolve: (root: string) => Promise<void>;
  setActive: (root: string, path: string | null) => void;
};

export const usePythonInterpreterStore = create<PyState>((set, get) => ({
  byRoot: {},
  resolve: async (root) => {
    const path = await resolvePythonInterpreter(root);
    set({ byRoot: { ...get().byRoot, [root]: path } });
  },
  setActive: (root, path) => set({ byRoot: { ...get().byRoot, [root]: path } }),
}));
