# Usage/quota endpoint spike — Claude Code & Codex

Task 1 spike for the per-provider usage/quota status bar indicator. Source
inspection only — no authenticated requests were made and no credential
files were read (see "Method" below).

## Method

Both CLIs are compiled/bundled artifacts, not readable source trees, so
"reading the installed CLI" means string-searching the shipped binaries:

- Claude Code: `which claude` → `/opt/homebrew/bin/claude` → symlink to
  `/opt/homebrew/Caskroom/claude-code@latest/2.1.207/claude`, a Mach-O
  arm64 executable (241 MB) containing a bundled/minified JS runtime.
  Searched with `grep -a -o '<pattern>' <binary>` (treat binary as text,
  extract matching substrings).
- Codex: `which codex` → `/opt/homebrew/bin/codex` → the npm-installed
  `codex.js` is only a launcher; it spawns the real native binary at
  `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
  (Mach-O arm64, Rust). That native binary was string-searched the same
  way.

No `~/.codex/auth.json`, `~/.claude/.credentials.json`, or macOS Keychain
item was read or dumped. No token value appears anywhere below.

---

## Claude Code

**Endpoint found:** `GET https://api.anthropic.com/api/oauth/usage`

Found directly in the binary as a log line and call site:

```
fetchUtilization: GET /api/oauth/usage (attempt ${e})
...
let r = await bi.get("/api/oauth/usage", {
  timeout: 5000,
  headers: { "Content-Type": "application/json" },
  refreshOAuth: true
})
```

- **Method:** GET
- **Path:** `/api/oauth/usage` on host `api.anthropic.com` (same host used
  for `/v1/messages`, `/api/oauth/claude_cli/*`, etc., all via the shared
  `bi` HTTP client in the bundle).
- **Headers directly visible on this call:** `Content-Type: application/json`.
  `refreshOAuth: true` is a client-option flag (auto-refresh the OAuth
  token and retry on 401), not an HTTP header itself.
- **Headers inferred but not directly co-located with this call site:**
  the bundle defines an OAuth beta flag `anthropic-beta: oauth-2025-04-20`
  and an `Authorization: Bearer <token>` header, both added by the shared
  client wrapper for all authenticated `api.anthropic.com` calls — not
  proven to be attached to this specific request by string adjacency
  alone.
- **Auth field:** OAuth token lives under the `claudeAiOauth.accessToken`
  key of the credentials store. On disk (non-macOS / fallback) that's
  `~/.claude/.credentials.json`; the binary also references generic
  `keychain` storage, consistent with the commonly-documented macOS
  Keychain item, but the literal service name string was not found in the
  binary, so that specific detail is **not independently confirmed** here.
- **Response shape:** the exact field names in the brief's representative
  body — `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`,
  `utilization`, `resets_at` — all appear verbatim in the binary (e.g.
  `rateLimitType: enum(["five_hour","seven_day","seven_day_opus",
  "seven_day_sonnet","seven_day_overage_included","overage"])` and a
  mapping `utilization: n.percent, resets_at: n.resets_at`), so the
  representative fixture's shape is corroborated by the CLI's own schema,
  even though no real response body was captured.

**Status: ships `Unavailable` until a real body is confirmed.** No
authenticated call was made; `claude_usage.json` is the brief's
representative body with `"_unconfirmed": true`.

---

## Codex

**No dedicated `/usage` REST endpoint was found.** Rate-limit/usage data
does not appear to live behind a single discoverable URL the way Claude
Code's does. What was found instead:

- **Base API hosts:** `https://chatgpt.com/backend-api/codex` (ChatGPT
  login / "Plus/Pro" auth mode) and `https://api.openai.com/v1` (API-key
  auth mode), used for the actual completions/responses traffic
  (`api.openai.com/v1/responses`).
- **Rate-limit data appears to ride along with normal traffic**, not a
  separate call:
  - Response headers seen in the binary's string table:
    `x-codex-rate-limit-reached-type`, `x-codex-credits-balance`,
    `x-codex-credits-has-credits`, `x-codex-credits-unlimited` — these
    look like they're returned on the same request that runs a turn, not
    fetched separately.
  - An internal (local, stdio) JSON-RPC "app-server" protocol exposes
    `GetAccountResponse { account, requiresOpenaiAuth }` and a
    `RateLimitSnapshot { limitId, limitName, primary, secondary, credits,
    individualLimit, planType, rateLimitReachedType }` type, where
    `primary`/`secondary` are `RateLimitWindow { used_percent,
    window_duration_mins, resets_at }`. This is Codex's own internal
    IPC schema (used by e.g. the VS Code extension talking to the `codex`
    binary), not a directly callable public HTTP endpoint we can point a
    fixture-fetcher at.
  - **Discrepancy vs. the task brief's representative body:** the field
    the binary actually uses is `resets_at` (an epoch timestamp), not
    `resets_in_seconds` as in the brief's representative
    `codex_usage.json`. Per the brief, the representative body is used
    verbatim regardless — noting the discrepancy here for whoever
    confirms a real body later (Task 3).
- **Method/headers:** not applicable — no single confirmed request to
  record method/headers for.
- **Auth field:** `~/.codex/auth.json` stores a `tokens` object with
  `access_token`, `refresh_token`, `account_id` (and a 4th field, almost
  certainly `id_token`, consistent with `TokenData` in the binary), plus a
  top-level `OPENAI_API_KEY` for API-key mode. The bearer token for
  ChatGPT-login mode is `tokens.access_token`; for API-key mode it's the
  `OPENAI_API_KEY` value directly. An `x-codex-account-id` /
  `chatgpt-account-id`-style header carrying `tokens.account_id` is also
  referenced in the binary.

**Status: ships `Unavailable` until a real body is confirmed.** No
authenticated call was made; `codex_usage.json` is the brief's
representative body with `"_unconfirmed": true`.

---

## Fixtures produced

- `src-tauri/src/modules/usage/fixtures/claude_usage.json`
- `src-tauri/src/modules/usage/fixtures/codex_usage.json`

Both are the brief's representative bodies verbatim, plus a top-level
`"_unconfirmed": true` key. Both validated with `python3 -m json.tool`.
