# Python Interpreter Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cmd+click (LSP go-to-definition) open third-party library source under a project's `.venv`, by detecting/selecting the Python interpreter and feeding it to pyright; let the user pick the interpreter from the command palette.

**Architecture:** pyright is told which interpreter to use by answering its `workspace/configuration` request with `python.pythonPath` (today the transport replies `null` to everything). The interpreter is auto-detected from the project (`.venv`/`venv`/PATH) or chosen via a palette sub-page (mirroring the existing theme picker) and persisted per project. Changing it restarts the pyright session so the new environment takes effect.

**Tech Stack:** TypeScript, React, Zustand, CodeMirror, `codemirror-languageserver`, Tauri IPC, Vitest, Biome.

## Global Constraints

- Scope is **Python/pyright only** (preset id `"pyright"`). No conda/pyenv/Homebrew enumeration; no non-Python runtime picker.
- Interpreter resolution order: **per-project override → `<root>/.venv/bin/python` → `<root>/venv/bin/python`** (Windows: `Scripts\python.exe`) **→ `python3`/`python` on PATH**. (`$VIRTUAL_ENV` is intentionally covered by the PATH fallback, not probed directly — see note in Task 3.)
- Feed pyright via the `workspace/configuration` reply; do **not** write a `pyrightconfig.json` into the user's project.
- Persistence mirrors `lspActivation`: a `Record<projectRoot, interpreterPath>` preference with a setter and the existing prefs-changed propagation.
- Preference key string: `"pythonInterpreters"`. Palette command id: `"python.selectInterpreter"`.
- On interpreter change: `restartPresetSessions("pyright")`.
- Run `pnpm check-types` and `pnpm lint` clean before every commit. Tests: `pnpm test <file>`.

---

### Task 1: `pythonInterpreters` preference

**Files:**
- Modify: `src/modules/settings/store.ts` (Preferences type ~line 134, KEY consts ~197, DEFAULT_PREFERENCES ~256, `loadPreferences` ~374, new setter after `setLspActivation` ~393, prefkey map ~644)

**Interfaces:**
- Produces: `Preferences.pythonInterpreters: Record<string, string>`; `setPythonInterpreter(root: string, path: string | null): Promise<void>`.

- [ ] **Step 1: Add the field to the `Preferences` type**

In the `Preferences` type, next to `lspActivation`/`lspCustomServers`, add:

```ts
  /** project root -> chosen Python interpreter path (overrides auto-detect). */
  pythonInterpreters: Record<string, string>;
```

- [ ] **Step 2: Add the storage key**

Next to `const KEY_LSP_CUSTOM_SERVERS = "lspCustomServers";` add:

```ts
const KEY_PYTHON_INTERPRETERS = "pythonInterpreters";
```

- [ ] **Step 3: Add the default**

In `DEFAULT_PREFERENCES`, next to `lspCustomServers: []`, add:

```ts
  pythonInterpreters: {},
```

- [ ] **Step 4: Load it in `loadPreferences`**

Next to the `lspCustomServers:` mapping in the returned object, add:

```ts
    pythonInterpreters:
      get<Record<string, string>>(KEY_PYTHON_INTERPRETERS) ??
      DEFAULT_PREFERENCES.pythonInterpreters,
```

- [ ] **Step 5: Add the setter**

After `setLspActivation`, add (mirrors it exactly):

```ts
export async function setPythonInterpreter(
  root: string,
  path: string | null,
): Promise<void> {
  const current =
    ((await store.get(KEY_PYTHON_INTERPRETERS)) as Record<string, string>) ?? {};
  const next = { ...current };
  if (path === null) delete next[root];
  else next[root] = path;
  await writePref(KEY_PYTHON_INTERPRETERS, next);
}
```

- [ ] **Step 6: Register in the prefs-changed key map**

In `onPreferencesChange`'s `map`, next to `[KEY_LSP_CUSTOM_SERVERS]: "lspCustomServers",` add:

```ts
    [KEY_PYTHON_INTERPRETERS]: "pythonInterpreters",
```

- [ ] **Step 7: Verify types**

Run: `pnpm check-types`
Expected: no errors. (No unit test here — this is trivial glue mirroring the untested `setLspActivation`; it is exercised end-to-end in Tasks 3–6.)

- [ ] **Step 8: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "feat(settings): add per-project pythonInterpreters preference"
```

---

### Task 2: Pure interpreter helpers

**Files:**
- Create: `src/modules/lsp/lib/pythonInterpreter.ts`
- Test: `src/modules/lsp/lib/pythonInterpreter.test.ts`

**Interfaces:**
- Produces:
  - `interpreterCandidates(root: string, isWindows?: boolean): string[]`
  - `interpreterLabel(path: string): string`
  - `buildPythonSettings(interpreter: string): Record<string, unknown>`
  - `chooseInterpreter(o: { override: string | null; existingVenv: string | null; pathPython: string | null }): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/modules/lsp/lib/pythonInterpreter.test.ts`:

```ts
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
    expect(s["python.analysis"]).toMatchObject({ useLibraryCodeForTypes: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/modules/lsp/lib/pythonInterpreter.test.ts`
Expected: FAIL — cannot import from `./pythonInterpreter`.

- [ ] **Step 3: Write the pure helpers**

Create `src/modules/lsp/lib/pythonInterpreter.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/modules/lsp/lib/pythonInterpreter.test.ts`
Expected: PASS (4 describes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/lsp/lib/pythonInterpreter.ts src/modules/lsp/lib/pythonInterpreter.test.ts
git commit -m "feat(lsp): pure Python interpreter helpers (candidates, label, settings)"
```

---

### Task 3: Async resolver, discovery, and active-interpreter store

**Files:**
- Modify: `src/modules/lsp/lib/pythonInterpreter.ts` (append)

**Interfaces:**
- Consumes: `native.fileStat` from `@/lib/native`; `detectBinary` from `./detect`; `usePreferencesStore` from `@/modules/settings/preferences`; helpers from Task 2.
- Produces:
  - `resolvePythonInterpreter(root: string): Promise<string | null>`
  - `discoverInterpreters(root: string): Promise<InterpreterOption[]>`
  - `pythonWorkspaceSettings(root: string): Promise<Record<string, unknown> | undefined>`
  - `usePythonInterpreterStore` — Zustand store `{ byRoot: Record<string, string | null>; resolve(root: string): Promise<void> }`

- [ ] **Step 1: Append the async resolver + store**

Add to `src/modules/lsp/lib/pythonInterpreter.ts`:

```ts
import { native } from "@/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { create } from "zustand";
import { detectBinary } from "./detect";

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
};

export const usePythonInterpreterStore = create<PyState>((set, get) => ({
  byRoot: {},
  resolve: async (root) => {
    const path = await resolvePythonInterpreter(root);
    set({ byRoot: { ...get().byRoot, [root]: path } });
  },
}));
```

- [ ] **Step 2: Verify types and existing tests still pass**

Run: `pnpm check-types && pnpm test src/modules/lsp/lib/pythonInterpreter.test.ts`
Expected: no type errors; Task 2 tests still PASS. (The async paths depend on Tauri IPC / stores and are verified manually in Task 4; their only non-trivial branch — precedence — is already covered by `chooseInterpreter`.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/lsp/lib/pythonInterpreter.ts
git commit -m "feat(lsp): resolve/discover Python interpreter + active-interpreter store"
```

---

### Task 4: Feed pyright the interpreter (transport settings)

**Files:**
- Modify: `src/modules/lsp/lib/transport.ts` (`LspSpawnConfig` ~5-11, class field, `start` ~45-70, `answerServerRequest` `workspace/configuration` case ~87-92)
- Modify: `src/modules/lsp/lib/sessionManager.ts` (`createSession` `transport.start` call ~216-222)

**Interfaces:**
- Consumes: `pythonWorkspaceSettings` from `./pythonInterpreter`.
- Produces: `LspSpawnConfig.settings?: Record<string, unknown>` honored in `workspace/configuration` replies.

- [ ] **Step 1: Add `settings` to `LspSpawnConfig`**

In `transport.ts`, add to the `LspSpawnConfig` type:

```ts
  /** LSP section -> value, returned for the server's workspace/configuration. */
  settings?: Record<string, unknown>;
```

- [ ] **Step 2: Store it on the transport and use it in the config reply**

Add a field to `TauriLspTransport` next to `exitInfo`:

```ts
  private settings: Record<string, unknown> = {};
```

At the top of `start(config)`, before creating channels, add:

```ts
    this.settings = config.settings ?? {};
```

Replace the `workspace/configuration` case body in `answerServerRequest`:

```ts
      case "workspace/configuration": {
        const items =
          (msg.params as { items?: { section?: string }[] } | undefined)
            ?.items ?? [];
        reply({
          result: items.map((it) =>
            it.section ? (this.settings[it.section] ?? null) : null,
          ),
        });
        return;
      }
```

- [ ] **Step 3: Compute + pass settings in `createSession`**

In `sessionManager.ts`, add the import near the other `./` imports:

```ts
import { pythonWorkspaceSettings } from "./pythonInterpreter";
```

Replace the `await transport.start({ ... })` call in `createSession` with:

```ts
    const settings =
      preset.id === "pyright"
        ? await pythonWorkspaceSettings(root)
        : undefined;
    await transport.start({
      command: preset.command,
      args: preset.args,
      root,
      env: preset.env,
      maxMemoryMb: preset.maxMemoryMb,
      settings,
    });
```

- [ ] **Step 4: Verify types**

Run: `pnpm check-types && pnpm lint src/modules/lsp/lib/transport.ts src/modules/lsp/lib/sessionManager.ts`
Expected: clean.

- [ ] **Step 5: Manual verification (the goal check)**

In a Python project with a `.venv` and pyright enabled:
1. `pnpm tauri dev`, reload the window.
2. Open a `.py` file that imports an installed library (e.g. `import requests`).
3. cmd+click the imported symbol.
Expected: a tab opens on the library's source under `.venv/.../site-packages`. (If it still fails, open devtools console and confirm no `[lsp]` errors; confirm `.venv/bin/python` exists.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/lsp/lib/transport.ts src/modules/lsp/lib/sessionManager.ts
git commit -m "feat(lsp): feed pyright the project interpreter via workspace/configuration"
```

---

### Task 5: Palette command + current-interpreter label

**Files:**
- Modify: `src/modules/command-palette/commands.ts` (`CommandPaletteActionContext` ~33-61, add item in `createCommandItems`)
- Test: `src/modules/command-palette/commands.test.ts` (add case + context default)
- Modify: `src/app/App.tsx` (createCommandItems ctx ~1179-1210 + deps; effect on palette open)

**Interfaces:**
- Consumes: `usePythonInterpreterStore`, `interpreterLabel` from `@/modules/lsp` (re-exported — see Step 1).
- Produces: command item id `"python.selectInterpreter"` with `trailing` = current interpreter label; ctx field `pythonInterpreterLabel: string | null`.

- [ ] **Step 1: Re-export the interpreter helpers from the lsp barrel**

In `src/modules/lsp/index.ts`, add:

```ts
export {
  discoverInterpreters,
  interpreterLabel,
  type InterpreterOption,
  usePythonInterpreterStore,
} from "./lib/pythonInterpreter";
```

- [ ] **Step 2: Add the ctx field + command item (failing test first)**

In `commands.test.ts`, add `pythonInterpreterLabel: null,` to the `context()` default object, then add:

```ts
  it("shows the current Python interpreter on the select command", () => {
    const items = createCommandItems(context({ pythonInterpreterLabel: ".venv" }));
    const item = items.find((i) => i.id === "python.selectInterpreter");
    expect(item?.title).toBe("Python: Select Interpreter");
    expect(item?.trailing).toBe(".venv");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/modules/command-palette/commands.test.ts`
Expected: FAIL — no item with id `python.selectInterpreter`.

- [ ] **Step 4: Add the ctx field and the command item**

In `commands.ts`, add to `CommandPaletteActionContext`:

```ts
  pythonInterpreterLabel: string | null;
```

Add `SourceCodeIcon` is already imported. Add this item to the returned array (place it in the `General` group, after `shortcuts.open`):

```ts
    {
      id: "python.selectInterpreter",
      title: "Python: Select Interpreter",
      group: "General",
      keywords: ["python", "interpreter", "venv", "environment", "pyright"],
      icon: SourceCodeIcon,
      trailing: ctx.pythonInterpreterLabel ?? undefined,
      run: noop,
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/modules/command-palette/commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the label + resolution in `App.tsx`**

Add import:

```ts
import { interpreterLabel, usePythonInterpreterStore } from "@/modules/lsp";
```

Near the other `useSpaces`/store selectors, derive the label:

```ts
  const pythonInterpreterPath = usePythonInterpreterStore((s) =>
    explorerRoot ? (s.byRoot[explorerRoot] ?? null) : null,
  );
  const pythonInterpreterLabel = pythonInterpreterPath
    ? interpreterLabel(pythonInterpreterPath)
    : null;
```

Resolve when the palette opens (add after the memo/handlers, with the other effects):

```ts
  useEffect(() => {
    if (commandPaletteOpen && explorerRoot) {
      void usePythonInterpreterStore.getState().resolve(explorerRoot);
    }
  }, [commandPaletteOpen, explorerRoot]);
```

Pass it into `createCommandItems({ ... })` (next to `explorerRoot`):

```ts
            pythonInterpreterLabel,
```

Add `pythonInterpreterLabel` to that `useMemo` dependency array.

- [ ] **Step 7: Verify**

Run: `pnpm check-types && pnpm lint src/modules/command-palette/commands.ts src/app/App.tsx && pnpm test src/modules/command-palette/commands.test.ts`
Expected: clean + PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/lsp/index.ts src/modules/command-palette/commands.ts src/modules/command-palette/commands.test.ts src/app/App.tsx
git commit -m "feat(command-palette): add Python: Select Interpreter command with current-interpreter label"
```

---

### Task 6: Palette interpreter sub-page

**Files:**
- Modify: `src/modules/command-palette/CommandPalette.tsx` (page state ~64, `runCommand` ~158-168, render body ~237)

**Interfaces:**
- Consumes: `discoverInterpreters`, `usePythonInterpreterStore`, `type InterpreterOption` from `@/modules/lsp`; `setPythonInterpreter` from `@/modules/settings/store`; `restartPresetSessions` from `@/modules/lsp` (re-export if needed); `native.fileStat` from `@/lib/native`.

- [ ] **Step 1: Re-export `restartPresetSessions` from the lsp barrel (if not already)**

In `src/modules/lsp/index.ts`, ensure:

```ts
export { restartPresetSessions } from "./lib/sessionManager";
```

- [ ] **Step 2: Add page state + discovery to `CommandPalette`**

Change the page state type:

```ts
  const [page, setPage] = useState<"root" | "themes" | "interpreters">("root");
```

Add imports at the top:

```ts
import { native } from "@/lib/native";
import {
  discoverInterpreters,
  type InterpreterOption,
  restartPresetSessions,
  usePythonInterpreterStore,
} from "@/modules/lsp";
import { setPythonInterpreter } from "@/modules/settings/store";
```

Add state + discovery effect (near the theme state):

```ts
  const [interps, setInterps] = useState<InterpreterOption[]>([]);
  const inInterps = page === "interpreters";
  const currentInterp = usePythonInterpreterStore((s) =>
    workspaceRoot ? (s.byRoot[workspaceRoot] ?? null) : null,
  );

  useEffect(() => {
    if (!inInterps || !workspaceRoot) return;
    let cancelled = false;
    void discoverInterpreters(workspaceRoot).then((list) => {
      if (!cancelled) setInterps(list);
    });
    return () => {
      cancelled = true;
    };
  }, [inInterps, workspaceRoot]);
```

- [ ] **Step 3: Add enter/exit + commit handlers**

```ts
  const enterInterpreters = useCallback(() => {
    setPage("interpreters");
    setQuery("");
    setValue("");
  }, []);

  const exitInterpreters = useCallback(() => {
    setPage("root");
    setQuery("");
    setValue("");
  }, []);

  const commitInterpreter = useCallback(
    (path: string) => {
      if (!workspaceRoot) return;
      void setPythonInterpreter(workspaceRoot, path).then(() => {
        void usePythonInterpreterStore.getState().resolve(workspaceRoot);
        void restartPresetSessions("pyright");
      });
      handleOpenChange(false);
    },
    [workspaceRoot, handleOpenChange],
  );
```

- [ ] **Step 4: Intercept the command id in `runCommand`**

Add to `runCommand`, next to the `theme.pick` line:

```ts
      if (item.id === "python.selectInterpreter") return enterInterpreters();
```

Add `enterInterpreters` to `runCommand`'s dependency array.

- [ ] **Step 5: Handle Escape/Backspace-out for the interpreter page**

Extend `onKeyDown` so it also exits interpreters:

```ts
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!inThemes && !inInterps) return;
      if (e.key === "Escape" || (e.key === "Backspace" && query.length === 0)) {
        e.preventDefault();
        e.stopPropagation();
        if (inThemes) exitThemes();
        else exitInterpreters();
      }
    },
    [inThemes, inInterps, query, exitThemes, exitInterpreters],
  );
```

- [ ] **Step 6: Render the interpreter page**

Update `placeholder` so interpreters mode reads `"Search interpreters or paste a path..."`:

```ts
  const placeholder = inInterps
    ? "Search interpreters or paste a path..."
    : inThemes
      ? "Search themes..."
      : parsed.mode === "content"
        ? "Find text in files..."
        : parsed.mode === "history"
          ? "Search command history..."
          : "Type a command, > for history, # to find in files";
```

In the `CommandList` body, add a branch as the FIRST condition (before `inThemes ?`):

```tsx
            {inInterps ? (
              <CommandGroup heading="Python interpreter">
                <CommandItem
                  value="interp:back"
                  onSelect={exitInterpreters}
                  className="text-[12.5px]"
                >
                  <HugeiconsIcon
                    icon={ArrowTurnBackwardIcon}
                    size={14}
                    strokeWidth={1.75}
                  />
                  <span>Back</span>
                </CommandItem>
                {interps.map((opt) => (
                  <CommandItem
                    key={opt.path}
                    value={`interp:${opt.path}`}
                    onSelect={() => commitInterpreter(opt.path)}
                    className="text-[12.5px]"
                  >
                    <span className="truncate">{opt.label}</span>
                    <span className="ml-2 min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {opt.path}
                    </span>
                    {opt.path === currentInterp ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={14}
                        strokeWidth={2}
                        className="ml-auto text-muted-foreground"
                      />
                    ) : null}
                  </CommandItem>
                ))}
                <ManualInterpreterEntry
                  query={query}
                  onUse={commitInterpreter}
                />
                {interps.length === 0 ? (
                  <StatusItem label="No interpreters found" />
                ) : null}
              </CommandGroup>
            ) : inThemes ? (
```

(The existing `inThemes ?` becomes the second branch — leave its body unchanged.)

- [ ] **Step 7: Add the manual-entry component**

At the bottom of the file with the other helper components, add:

```tsx
function ManualInterpreterEntry({
  query,
  onUse,
}: {
  query: string;
  onUse: (path: string) => void;
}) {
  const [exists, setExists] = useState(false);
  const trimmed = query.trim();
  const looksAbsolute = trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);

  useEffect(() => {
    if (!looksAbsolute) {
      setExists(false);
      return;
    }
    let cancelled = false;
    void native
      .fileStat(trimmed)
      .then((s) => !cancelled && setExists(s.kind === "file" || s.kind === "symlink"))
      .catch(() => !cancelled && setExists(false));
    return () => {
      cancelled = true;
    };
  }, [trimmed, looksAbsolute]);

  if (!looksAbsolute) return null;
  return (
    <CommandItem
      value={`interp:manual:${trimmed}`}
      disabled={!exists}
      onSelect={() => onUse(trimmed)}
      className="text-[12.5px]"
    >
      <span className="truncate">
        {exists ? `Use ${trimmed}` : "Path not found"}
      </span>
    </CommandItem>
  );
}
```

- [ ] **Step 8: Verify types + lint**

Run: `pnpm check-types && pnpm lint src/modules/command-palette/CommandPalette.tsx src/modules/lsp/index.ts`
Expected: clean.

- [ ] **Step 9: Manual verification**

1. `pnpm tauri dev`, reload window, open a Python project with a `.venv`.
2. Open the command palette, type "interpreter", select **Python: Select Interpreter** — its row shows the current interpreter (e.g. `.venv`).
3. The sub-page lists `.venv` (✓), other detected pythons, and — if you paste an absolute path to a python binary — a "Use <path>" row.
4. Pick a different interpreter; reopen the palette — the command row shows the new one; cmd+click a library symbol resolves against it.

- [ ] **Step 10: Commit**

```bash
git add src/modules/command-palette/CommandPalette.tsx src/modules/lsp/index.ts
git commit -m "feat(command-palette): Python interpreter picker sub-page"
```

---

## Self-Review

**Spec coverage:**
- Auto-detect + feed pyright → Tasks 2, 3, 4. ✓
- Resolution order (override→.venv→venv→PATH) → Task 3 `resolvePythonInterpreter` + Task 2 `chooseInterpreter`. ✓ (`$VIRTUAL_ENV` folded into PATH fallback — noted in Global Constraints and Task 3.)
- `workspace/configuration` reply with `python.pythonPath` + analysis → Task 4 + Task 2 `buildPythonSettings`. ✓
- Palette command "Python: Select Interpreter…" with sub-page (candidates, manual entry, back, ✓) → Tasks 5, 6. ✓
- Command row shows current interpreter → Task 5. ✓
- Persist per project + restart pyright on change → Task 1 + Task 6 `commitInterpreter`. ✓
- Manual entry validates existence → Task 6 `ManualInterpreterEntry`. ✓
- Out of scope (status bar, conda/pyenv, other languages) → not built. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `pythonInterpreters` (pref), `resolvePythonInterpreter`/`discoverInterpreters`/`pythonWorkspaceSettings`/`usePythonInterpreterStore`/`interpreterLabel`/`InterpreterOption` used consistently across Tasks 2–6; `setPythonInterpreter(root, path|null)` matches Task 1; `restartPresetSessions("pyright")` matches existing signature.
