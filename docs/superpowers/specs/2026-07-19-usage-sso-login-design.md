# Usage SSO login — design (pivot from CLI-cred reuse)

**Supersedes** the credential-reuse approach in `2026-07-19-sso-usage-quota-status-design.md`
for how tokens are obtained. The status-bar UI, states, parsing, and endpoints
are unchanged — only the **token source** changes.

## Why pivot

Reusing the CLIs' own tokens (`~/.codex/auth.json`, Claude Keychain) fails because
the providers **rotate** refresh tokens and the CLIs rewrite their stores. Pide
kept grabbing tokens that were already rotated out → Codex flips to "Sign in
again" while actively in use. Fix: Pide does its **own** browser OAuth login and
owns tokens it can persist and refresh without contending with the CLI.

## Decisions (confirmed)

- Both providers (Codex + Claude) in this pass.
- **SSO-only**: delete CLI-credential reading; our OAuth tokens are the only source.

## Confirmed OAuth parameters (from the CLIs' binaries)

| | Codex | Claude |
|---|---|---|
| authorize | `https://auth.openai.com/oauth/authorize` | `https://platform.claude.com/oauth/authorize` |
| token | `https://auth.openai.com/oauth/token` | `https://platform.claude.com/v1/oauth/token` |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| redirect | `http://localhost:1455/auth/callback` (loopback) | `/oauth/code/callback` (manual code paste) |
| scopes | `openid profile email offline_access` | `user:profile user:inference offline_access` |
| PKCE | S256 | S256 |
| usage GET | `chatgpt.com/backend-api/codex/usage` (+ `chatgpt-account-id`) | `api.anthropic.com/api/oauth/usage` (+ `anthropic-beta: oauth-2025-04-20`) |
| gotchas | none | token host is Cloudflare-UA-gated (needs `User-Agent: claude-code/<ver>`) + rate-limited |

## Architecture

### Backend — new `src-tauri/src/modules/oauth/`

- `mod.rs` — Tauri commands + provider registry.
- `pkce.rs` — generate `code_verifier` + S256 `code_challenge` + `state` (pure, tested).
- `flow.rs` — the login flow:
  - **Loopback (Codex):** bind `127.0.0.1:1455`, open browser to the authorize URL,
    wait for `GET /auth/callback?code=&state=`, verify `state`, respond with a
    "you can close this tab" page, return the `code`.
  - **Manual paste (Claude):** open browser to the authorize URL; the command
    returns "awaiting code"; a second command `usage_login_finish(provider, code)`
    accepts the pasted code. (Loopback used if the client turns out to allow it.)
- `token.rs` — exchange `code`+`code_verifier` → tokens at the token URL; refresh;
  send the provider's required `User-Agent`. Returns `{access, refresh, expires_at, id_token}`.
- `store.rs` — persist/load/delete tokens in the **OS keychain** via the `keyring`
  crate, key `pide-usage-<provider>`. JSON blob `{access, refresh, expires_at, account}`.
- Commands: `usage_login_start(provider)`, `usage_login_finish(provider, code?)`,
  `usage_logout(provider)`, plus `usage_connected(provider) -> bool`.

### Token use (replaces CLI-cred reading)

`fetch_claude`/`fetch_codex` become: load our stored tokens from keychain →
if `access` is unexpired, call usage with it → on expiry or 401, refresh with our
`refresh` token, **persist the new tokens back to our keychain**, retry once. We
own these tokens, so persisting is correct and safe (no CLI contention). If no
stored tokens → `SignedOut`. If refresh fails → `AuthExpired` (user re-logs in
from Settings).

### Frontend

- **Settings** (`src/modules/settings`): a "Usage accounts" section — per provider,
  a Connect button (triggers `usage_login_start`; for Claude, a code input +
  Finish), the connected email, and Disconnect (`usage_logout`).
- The status-bar chip/popover (`src/modules/usage`) are unchanged; the popover's
  "Disconnect"/"Manage Accounts…" routes to Settings. Store gains `login`/`logout`
  actions calling the new commands.

### Removed

- `read_auth()` / reading `~/.codex/auth.json`; Claude Keychain `Claude Code-credentials`
  read + `parse_claude_creds`. The `parse_codex_usage`/`parse_claude_usage` +
  window logic **stay** (same endpoints/shapes).

## New dependency

- `keyring` (Rust) for OS-keychain token storage. (Alternative: `security` CLI +
  file, but `keyring` is cross-platform and purpose-built.)

## Security

- PKCE S256; random `state` verified on callback (CSRF).
- Loopback bound to `127.0.0.1` only; server lives only for the duration of one login.
- Tokens stored **only** in the OS keychain; never in settings/files/logs.
- Smallest scopes that yield identity + usage + a refresh token.
- Our tokens are independent of the CLIs' — logging out deletes only our keychain entry.

## States (unchanged set)

`SignedOut` (not connected) · `Loading` · `Ok` · `Limited` · `Stale` · `Unavailable` · `AuthExpired`.

## Risks

- **Claude redirect is manual-code-paste**, not loopback → clunkier UX (copy/paste a code).
- **Claude token host** is Cloudflare-UA-gated + rate-limited → send the CLI UA; refresh
  only on expiry.
- Port 1455 must be free during Codex login (used transiently, same as the CLI).
- Reusing the providers' public client_ids for our own PKCE grant assumes they permit
  it (standard for public/PKCE clients; verify during the loopback/paste spike).

## Acceptance

- Settings shows Connect for each provider; clicking Codex opens the browser, and
  after approving, the status bar shows live Codex usage with **no** CLI dependency.
- Claude connect works via code paste and shows live usage.
- Tokens survive restart (keychain); expiry triggers a silent refresh that persists.
- Disconnect removes our stored tokens and clears the chip.
- No `~/.codex/auth.json` / Claude-CLI Keychain reads remain.
