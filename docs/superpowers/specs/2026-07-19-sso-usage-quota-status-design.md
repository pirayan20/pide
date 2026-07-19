# SSO usage & quota status — design

**Todo:** `todos/06-sso-usage-quota-status.md`
**Date:** 2026-07-19
**Status:** Approved for planning

## Goal

Fill the currently-empty far-right area of Pide's bottom status bar with a compact
remaining-usage indicator for the coding-agent providers the user is already logged
into (Claude Code, Codex), matching the orca reference UI: an icon, a mini progress
bar, `"X% used <window>"`, and a refresh button, with a click-through popover showing
every quota window, reset times, account, plan, and freshness.

## Core decision: reuse existing CLI logins

Pide does **not** implement its own OAuth/SSO. It reads the credentials the user's
`claude` and `codex` CLIs already stored, and calls the same usage endpoints those
CLIs use. This is how orca works and is what the user chose.

Consequence for the todo's security rules:

- The todo says *"do not silently reuse CLI credentials unless … the user approves it."*
  Approval is the in-app opt-in ("Connect Claude usage") **plus** the OS's own Keychain
  prompt that fires the first time Pide reads the macOS `Claude Code-credentials` item.
- Tokens are read **on demand**, held in memory only for the duration of one request,
  and **never persisted by Pide, never written to settings/store/logs**. Pide stores no
  credential of its own, so there is nothing for Pide to leak.

## Architecture

```
Frontend (React)                         Backend (Rust / Tauri)
─────────────────                        ──────────────────────
src/modules/usage/                       src-tauri/src/modules/usage/
  store/usageStore.ts  ──invoke──▶         mod.rs        (commands + cache + state)
  UsageStatus.tsx                          provider.rs   (ProviderUsage types, window selector)
  UsagePopover.tsx                         claude.rs     (creds + endpoint + parse)
  lib/format.ts                            codex.rs      (creds + endpoint + parse)
                                           refresh.rs    (background interval + backoff)
StatusBar.tsx renders <UsageStatus/> far right
```

### Backend module `src-tauri/src/modules/usage/`

Registered in `modules/mod.rs` and `lib.rs` (`.manage(UsageState::default())` +
`generate_handler![usage_snapshot, usage_refresh, usage_connect, usage_disconnect]`),
following the existing `agent`/`lsp` command pattern (sync `#[tauri::command] pub fn`).

**Commands**

| Command | Behavior |
|---|---|
| `usage_snapshot() -> Vec<ProviderUsage>` | Return the cached snapshot for every connected provider. Never blocks on network. |
| `usage_refresh(provider: String)` | Force-fetch one provider now (used by the refresh button). Respects backoff. |
| `usage_connect(provider: String)` | Mark provider connected; triggers a fetch (this is where the Keychain prompt may fire). |
| `usage_disconnect(provider: String)` | Mark provider disconnected; drop its cached snapshot. Does **not** touch the CLI's own login. |

**Types** (`provider.rs`)

```rust
struct ProviderUsage {
    provider: String,          // "claude" | "codex"
    status: UsageStatus,       // enum below
    account: Option<String>,   // email
    plan: Option<String>,      // e.g. "Max", "Pro"
    windows: Vec<QuotaWindow>, // one per rate-limit window
    fetched_at: i64,           // unix ms of last successful fetch
}
struct QuotaWindow {
    label: String,             // "Session"/"5h", "Weekly", "Fable", …
    used_pct: f32,             // 0..100  (see "Used vs remaining")
    resets_at: Option<i64>,    // unix ms
}
enum UsageStatus { SignedOut, Loading, Ok, Limited, Stale, Unavailable, AuthExpired }
```

`provider.rs` also owns `most_constrained(&[QuotaWindow]) -> &QuotaWindow` — the window
with the highest `used_pct` — used to order the collapsed status-bar text.

**Credential sources**

- **Codex** (`codex.rs`): read `~/.codex/auth.json` (plain file), extract the access
  token / account id, `GET` the ChatGPT/Codex rate-limit endpoint with a bearer header.
- **Claude** (`claude.rs`): obtain the OAuth token —
  - macOS: `security find-generic-password -s "Claude Code-credentials" -w`
    (via `std::process::Command`; this is the Keychain approval boundary).
  - Linux: read `~/.claude/.credentials.json`.
  Then `GET` the Anthropic OAuth usage endpoint with `Authorization: Bearer …` and the
  OAuth beta header. Parse the 5h / weekly / weekly-Opus("Fable") windows.

> ⚠️ **Endpoint uncertainty.** Both usage endpoints are undocumented. **Implementation
> step 1 is a spike** to pin the exact URLs/headers by inspecting what the CLIs call.
> If the spike cannot confirm an endpoint, that provider ships in the `Unavailable`
> state — Pide never estimates or scrapes an unstable private path without it being an
> explicit, recorded decision (todo requirement).

**HTTP + caching + backoff** (`mod.rs`, `refresh.rs`)

- New dep: `reqwest = { version = "0.12", default-features = false, features = ["blocking", "rustls-tls", "json"] }`. Blocking client is safe because commands are sync (run off the async runtime). *ponytail alt: `ureq` if we want fewer deps; reqwest chosen for clean JSON+TLS.*
- `UsageState = Mutex<HashMap<String, CachedUsage>>` holds the last snapshot + a
  `next_allowed_fetch` instant per provider.
- **Backoff:** on `429` or transport error, set `next_allowed_fetch` with exponential
  growth (e.g. 1m → 2m → 4m … cap 30m). A manual refresh before that time returns the
  cached (stale) snapshot rather than hammering the provider.
- **Background refresh:** `tauri::async_runtime::spawn` a `tokio::time::interval`
  (~5 min) that refreshes only connected providers and respects backoff.

### Frontend module `src/modules/usage/`

Mirrors the existing `agents` module (Zustand store like `agentStore.ts`; `invoke` from
`@tauri-apps/api/core` like `lsp/lib/transport.ts`).

- **`store/usageStore.ts`** — holds `ProviderUsage[]`; `refreshAll()` / `refresh(p)` /
  `connect(p)` / `disconnect(p)` call the commands; recomputes derived `Stale` when
  `now - fetched_at` exceeds a threshold.
- **`UsageStatus.tsx`** — rendered in `StatusBar.tsx`, pinned far right **outside** the
  `min-w-0 flex-1` container so it hugs the right edge. One compact entry per connected
  provider: provider icon (reuse `agents/lib/agentIcon.tsx`) + mini progress bar +
  `"38% used 5h · 4% used wk · 2% used Fable"` (windows ordered by `most_constrained`) +
  a refresh button. Hidden entirely when no provider is connected.
- **`UsagePopover.tsx`** — click a provider entry → popover (shadcn `Popover`, already in
  the repo) showing: provider name + "Updated Xm ago"; each window with its own bar,
  `% used`, and reset time ("Resets in 5d 21h"); account email; plan; and
  **Manage / Disconnect**. Matches the orca screenshots.
- **`lib/format.ts`** — `formatWindowLabel`, `formatReset(resetsAt)` ("Resets in 5d 21h"),
  `formatFreshness(fetchedAt)` ("Updated just now" / "3m ago").

### States (todo requirement)

| State | Status-bar rendering |
|---|---|
| Signed out | entry hidden; nothing added to the bar |
| Loading | icon + indeterminate/pulsing bar |
| Ok (available) | icon + bar + `% used <window>` |
| Limited / exhausted | amber/red bar + "Limited" (orca style) |
| Stale | dimmed + popover "Updated Xm ago" |
| Unavailable | icon + "Usage unavailable" (provider exposes no quota) |
| Auth expired | icon + "Sign in again" |

### Refresh triggers

App start (on store init) · manual refresh button · background interval (~5 min,
connected only) · window focus (reuse `agents/lib/useWindowFocus.ts`, cheap). All go
through the same backoff gate.

## v1 scope

Claude + Codex only (both shown in orca; todo says "start with" these). Gemini/Pi are
out of v1 but use the same `provider.rs` shape, so they slot in later without redesign.

## Deviations from the todo's wording (approved)

1. **"Used" not "remaining."** Orca and the reference screenshots show `% used`; the
   status bar shows used. (`used_pct` is the field; flipping to remaining is `100 - x`
   in `format.ts` if ever wanted.)
2. **"Disconnect" not "logout."** The todo says logout removes stored credentials, but
   reuse means Pide stores none — and deleting the CLI's own login would break the user's
   `claude`/`codex` CLIs. "Disconnect" stops Pide reading the creds and clears the display.

## Testing (one runnable check per non-trivial path)

- Rust `#[test]`: usage-JSON → `Vec<QuotaWindow>` parsing (per provider, from a captured
  sample body); `most_constrained` selector; backoff schedule (429 → grows, caps).
- Frontend: `format.ts` — `formatReset` / `formatFreshness` / label ordering.
- No network in tests; parsing is tested against fixed sample bodies.

## Out of scope

Separate OAuth/SSO; Gemini/Pi providers; historical usage graphs; cost/$ tracking;
writing or refreshing the CLIs' own tokens.
