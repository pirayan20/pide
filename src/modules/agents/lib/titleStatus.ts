/** Terminal-title heuristics for coding-agent status, ported from Orca's
 * shared agent-title detection. Titles are the one signal every agent CLI
 * emits, so agents work without Pide hooks or prior registration: a braille
 * spinner frame means working, well-known glyphs and keywords refine it, and
 * anything else stays neutral. */

export type TitleAgentStatus = "working" | "permission" | "idle";

const CLAUDE_IDLE = "✳"; // asterisk glyph Claude Code prefixes when idle
const GEMINI_WORKING = "✦";
const GEMINI_SILENT_WORKING = "⏲";
const GEMINI_IDLE = "◇";
const GEMINI_PERMISSION = "✋";

// Whole-token matching only: substring matching mis-fires on cwd titles like
// "~/claude-project" or "opencode-blinker". The boundary guard rejects path
// separators and hyphenated compounds on both sides; an optional Windows
// launcher suffix (claude.exe) still matches.
const AGENT_NAMES = [
  "claude",
  "codex",
  "gemini",
  "copilot",
  "cursor",
  "opencode",
  "openclaude",
  "aider",
  "grok",
  "devin",
  "droid",
  "goose",
] as const;

const NAME_LABELS: Record<(typeof AGENT_NAMES)[number], string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  copilot: "Copilot",
  cursor: "Cursor",
  opencode: "OpenCode",
  openclaude: "OpenClaude",
  aider: "Aider",
  grok: "Grok",
  devin: "Devin",
  droid: "Droid",
  goose: "Goose",
};

const WIN_EXE_SUFFIX = String.raw`(?:\.(?:exe|cmd|bat|ps1))`;

function nameRe(name: string): RegExp {
  return new RegExp(
    `(?<![\\w./\\\\-])${name}${WIN_EXE_SUFFIX}?(?![\\w./\\\\-])`,
    "i",
  );
}

const NAME_RES = AGENT_NAMES.map((name) => [name, nameRe(name)] as const);

const ANY_NAME_RE = new RegExp(
  AGENT_NAMES.map(
    (name) => `(?<![\\w./\\\\-])${name}${WIN_EXE_SUFFIX}?(?![\\w./\\\\-])`,
  ).join("|"),
  "i",
);

// Boundary-guarded so "reworking" or "~/codex/ready" never flips status.
const STRONG_IDLE_RE = /(?<![\w./\\-])(ready|idle|done)(?![\w-])/i;
const STRONG_WORKING_RE = /(?<![\w./\\-])(working|thinking|running)(?![\w-])/i;

export function containsBrailleSpinner(title: string): boolean {
  for (const char of title) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && cp >= 0x2800 && cp <= 0x28ff) return true;
  }
  return false;
}

function containsAny(title: string, words: readonly string[]): boolean {
  const lower = title.toLowerCase();
  return words.some((w) => lower.includes(w));
}

export function detectAgentStatusFromTitle(
  title: string,
): TitleAgentStatus | null {
  if (!title) return null;

  if (title.includes(GEMINI_PERMISSION)) return "permission";
  if (title.includes(GEMINI_WORKING) || title.includes(GEMINI_SILENT_WORKING)) {
    return "working";
  }
  if (title.includes(GEMINI_IDLE)) return "idle";

  if (title.startsWith(`${CLAUDE_IDLE} `) || title === CLAUDE_IDLE) {
    return "idle";
  }
  // Any agent's spinner frame, named or not: activity without identity.
  if (containsBrailleSpinner(title)) return "working";

  if (!ANY_NAME_RE.test(title)) return null;
  if (containsAny(title, ["action required", "permission", "waiting"])) {
    return "permission";
  }
  if (STRONG_IDLE_RE.test(title)) return "idle";
  if (STRONG_WORKING_RE.test(title)) return "working";
  if (title.startsWith(". ")) return "working";
  if (title.startsWith("* ")) return "idle";
  return "idle";
}

/** Display label for the agent a title identifies, or null when the title
 * proves activity but not identity (a bare spinner frame or task text). */
export function agentLabelFromTitle(title: string): string | null {
  if (!title) return null;
  if (
    title.startsWith(`${CLAUDE_IDLE} `) ||
    title === CLAUDE_IDLE ||
    title.startsWith(". ") ||
    title.startsWith("* ")
  ) {
    return "Claude Code";
  }
  if (
    title.includes(GEMINI_PERMISSION) ||
    title.includes(GEMINI_WORKING) ||
    title.includes(GEMINI_SILENT_WORKING) ||
    title.includes(GEMINI_IDLE)
  ) {
    return "Gemini";
  }
  for (const [name, re] of NAME_RES) {
    if (re.test(title)) return NAME_LABELS[name];
  }
  return null;
}

// Wrappers whose first argument is the real program.
const RUNNERS = new Set(["npx", "pnpm", "bunx", "yarn", "uvx", "uv"]);
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
  "env",
  "sudo",
]);

/** Best-effort agent name from an OSC 133;C command line ("jcode --yes" ->
 * "jcode"). Identity fallback for agents whose titles never name them. */
export function agentNameFromCommand(command: string): string | null {
  const tokens = command.trim().split(/\s+/);
  let sawRunner = false;
  for (const token of tokens) {
    if (token.startsWith("-") || token.includes("=")) continue;
    const base = (token.split(/[\\/]/).pop() ?? token)
      .replace(/\.(exe|cmd|bat|ps1|js|mjs|py)$/i, "")
      .toLowerCase();
    if (!base) continue;
    if (SHELLS.has(base)) continue;
    if (RUNNERS.has(base)) {
      sawRunner = true;
      continue;
    }
    // "pnpm run dev": subcommand after a runner is not a program name.
    if (sawRunner && (base === "run" || base === "exec" || base === "dlx")) {
      continue;
    }
    return /^[\w.-]+$/.test(base) ? base : null;
  }
  return null;
}
