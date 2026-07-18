import { IS_WINDOWS } from "@/lib/platform";

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
