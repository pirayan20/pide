# SSO Usage & Quota Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact per-provider usage/quota indicator in the empty far-right of Pide's status bar, fed by the Claude Code + Codex logins already on the machine, with a click-through popover of every quota window.

**Architecture:** A new Rust module (`src-tauri/src/modules/usage/`) reads the CLIs' existing OAuth credentials on demand, calls each provider's usage endpoint, and serves a cached `ProviderUsage` snapshot through Tauri commands with per-provider exponential backoff. A new React module (`src/modules/usage/`) renders the status-bar item + popover from a Zustand store that drives all refreshes (app start, focus, interval, manual button) through those commands.

**Tech Stack:** Rust / Tauri v2 (sync `#[tauri::command]`), `reqwest` (blocking, rustls-tls, json), `serde_json`; React + TypeScript, Zustand, shadcn `Popover`, `@hugeicons`, Vitest.

## Global Constraints

- **Credentials:** read on demand, held in memory for one request only. **Never** persist a token to settings/store/workspace/log files. Pide stores no credential of its own.
- **Endpoints are undocumented.** The exact URLs/headers/JSON field names are confirmed by the Task 1 spike. All fixtures/parsers below use a **representative shape** that Task 1 replaces with the real captured body; parser field names are updated together with their fixtures if reality differs. If an endpoint cannot be confirmed, that provider ships permanently in `Unavailable` (no estimation, no scraping).
- **Display "used", not "remaining"** (matches orca). Field is `used_pct` (0–100).
- **v1 providers:** `claude` and `codex` only.
- **Provider string values:** `"claude"`, `"codex"`.
- **`UsageStatus` values (serde snake_case):** `signed_out`, `loading`, `ok`, `limited`, `stale`, `unavailable`, `auth_expired`.
- **Limited threshold:** a window at `used_pct >= 95.0` marks the provider `limited`.
- **Rust commands are sync `pub fn`** (run off the async runtime, so blocking `reqwest` is safe), registered in `src-tauri/src/lib.rs` and `src-tauri/src/modules/mod.rs`, matching the existing `agent`/`lsp` pattern.
- **Follow existing module layout:** frontend under `src/modules/usage/` mirroring `src/modules/agents/`; commit after every green step.

---

### Task 1: Spike — confirm provider endpoints and capture fixtures

**Files:**
- Create: `src-tauri/src/modules/usage/fixtures/claude_usage.json`
- Create: `src-tauri/src/modules/usage/fixtures/codex_usage.json`
- Create: `docs/superpowers/notes/2026-07-19-usage-endpoints.md`

**Interfaces:**
- Produces: two captured JSON bodies (real if confirmable, otherwise the representative bodies below marked "UNCONFIRMED") that Tasks 3–4 parse; a notes file recording the exact URL, method, headers, and auth for each provider, or "unavailable" if not found.

- [ ] **Step 1: Discover the Claude usage endpoint.** Inspect how Claude Code's `/usage` command fetches data — read the installed CLI (`which claude` → resolve the JS bundle) and grep for `api.anthropic.com` + `usage` + the OAuth beta header. Record URL, method, and required headers (`Authorization: Bearer …`, `anthropic-beta`) in the notes file. Do **not** paste any real token into the notes.

- [ ] **Step 2: Discover the Codex usage endpoint.** Same for Codex — grep the installed `codex` CLI for the rate-limit/usage request it issues after ChatGPT login. Record URL, method, headers, and which field of `~/.codex/auth.json` supplies the bearer token.

- [ ] **Step 3: Capture a real body for each (best effort).** If you can issue the calls with the user's existing login, save the raw JSON responses to the two fixture files. If a call cannot be confirmed, write the representative body below into the fixture, add a top-level `"_unconfirmed": true` key, and note in the notes file that this provider ships `Unavailable` until confirmed.

Representative `claude_usage.json` (replace with real if captured):
```json
{
  "five_hour": { "utilization": 38, "resets_at": 1752949200 },
  "seven_day": { "utilization": 4, "resets_at": 1753500000 },
  "seven_day_opus": { "utilization": 2, "resets_at": 1753500000 },
  "account": { "email": "user@example.com", "plan": "max" }
}
```
Representative `codex_usage.json` (replace with real if captured):
```json
{
  "primary": { "used_percent": 26, "resets_in_seconds": 507600 },
  "account": { "email": "user@example.com" }
}
```

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/modules/usage/fixtures docs/superpowers/notes/2026-07-19-usage-endpoints.md
git commit -m "spike(usage): capture provider usage endpoints and sample bodies"
```

---

### Task 2: Backend core types, window selector, status + backoff logic

**Files:**
- Create: `src-tauri/src/modules/usage/mod.rs` (types + pure logic only in this task)
- Modify: `src-tauri/src/modules/mod.rs` (add `pub mod usage;`)

**Interfaces:**
- Produces:
  - `pub struct QuotaWindow { pub label: String, pub used_pct: f32, pub resets_at: Option<i64> }`
  - `pub enum UsageStatus` (7 variants, serde snake_case)
  - `pub struct ProviderUsage { pub provider: String, pub status: UsageStatus, pub account: Option<String>, pub plan: Option<String>, pub windows: Vec<QuotaWindow>, pub fetched_at: i64 }`
  - `pub fn most_constrained(windows: &[QuotaWindow]) -> Option<&QuotaWindow>`
  - `pub fn status_from_windows(windows: &[QuotaWindow]) -> UsageStatus`
  - `pub fn next_backoff_ms(failures: u32) -> i64`

- [ ] **Step 1: Add the module declaration.** In `src-tauri/src/modules/mod.rs`, add the line (alphabetical, before `workspace`):
```rust
pub mod usage;
```

- [ ] **Step 2: Write the failing tests.** Create `src-tauri/src/modules/usage/mod.rs` with types + a test module (implementations `todo!()` for now is not needed — write the real signatures returning defaults so it compiles-fails on assertions). Start with tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn w(label: &str, used: f32) -> QuotaWindow {
        QuotaWindow { label: label.into(), used_pct: used, resets_at: None }
    }

    #[test]
    fn most_constrained_picks_highest_used() {
        let ws = vec![w("5h", 38.0), w("Weekly", 4.0), w("Fable", 2.0)];
        assert_eq!(most_constrained(&ws).unwrap().label, "5h");
    }

    #[test]
    fn most_constrained_empty_is_none() {
        assert!(most_constrained(&[]).is_none());
    }

    #[test]
    fn status_ok_below_threshold() {
        assert_eq!(status_from_windows(&[w("5h", 94.9)]), UsageStatus::Ok);
    }

    #[test]
    fn status_limited_at_threshold() {
        assert_eq!(status_from_windows(&[w("5h", 4.0), w("Weekly", 95.0)]), UsageStatus::Limited);
    }

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(next_backoff_ms(0), 60_000);
        assert_eq!(next_backoff_ms(1), 120_000);
        assert_eq!(next_backoff_ms(4), 960_000);
        assert_eq!(next_backoff_ms(5), 1_800_000); // capped
        assert_eq!(next_backoff_ms(9), 1_800_000); // stays capped
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**
Run: `cd src-tauri && cargo test usage::tests`
Expected: compile OK, assertions FAIL.

- [ ] **Step 4: Write the implementation.** In the same file, above the tests:
```rust
pub const LIMITED_THRESHOLD: f32 = 95.0;

#[derive(Clone, serde::Serialize)]
pub struct QuotaWindow {
    pub label: String,
    pub used_pct: f32,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatus {
    SignedOut,
    Loading,
    Ok,
    Limited,
    Stale,
    Unavailable,
    AuthExpired,
}

#[derive(Clone, serde::Serialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub status: UsageStatus,
    pub account: Option<String>,
    pub plan: Option<String>,
    pub windows: Vec<QuotaWindow>,
    pub fetched_at: i64,
}

pub fn most_constrained(windows: &[QuotaWindow]) -> Option<&QuotaWindow> {
    windows
        .iter()
        .max_by(|a, b| a.used_pct.partial_cmp(&b.used_pct).unwrap_or(std::cmp::Ordering::Equal))
}

pub fn status_from_windows(windows: &[QuotaWindow]) -> UsageStatus {
    match most_constrained(windows) {
        Some(w) if w.used_pct >= LIMITED_THRESHOLD => UsageStatus::Limited,
        _ => UsageStatus::Ok,
    }
}

pub fn next_backoff_ms(failures: u32) -> i64 {
    let base: i64 = 60_000;
    let factor = 1i64 << failures.min(5);
    (base.saturating_mul(factor)).min(30 * 60_000)
}
```

- [ ] **Step 5: Run tests to verify they pass**
Run: `cd src-tauri && cargo test usage::tests`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/modules/mod.rs src-tauri/src/modules/usage/mod.rs
git commit -m "feat(usage): core types, window selector, status + backoff"
```

---

### Task 3: Claude usage source (creds + fetch + parse)

**Files:**
- Create: `src-tauri/src/modules/usage/claude.rs`
- Modify: `src-tauri/src/modules/usage/mod.rs` (add `mod claude;`)
- Modify: `src-tauri/Cargo.toml` (add `reqwest`)

**Interfaces:**
- Consumes: `QuotaWindow`, `ProviderUsage`, `UsageStatus`, `status_from_windows` from Task 2.
- Produces:
  - `pub fn parse_claude_creds(json: &str) -> Option<String>` — extracts the OAuth access token.
  - `pub fn parse_claude_usage(body: &serde_json::Value) -> (Vec<QuotaWindow>, Option<String>, Option<String>)` — `(windows, account_email, plan)`.
  - `pub fn fetch_claude() -> ProviderUsage` — full pipeline (creds → HTTP → parse), used by Task 5.

- [ ] **Step 1: Add the `reqwest` dependency.** In `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "rustls-tls", "json"] }
```
Run: `cd src-tauri && cargo build` — Expected: builds (downloads reqwest).

- [ ] **Step 2: Declare the submodule.** In `src-tauri/src/modules/usage/mod.rs` add near the top:
```rust
mod claude;
pub use claude::fetch_claude;
```

- [ ] **Step 3: Write the failing tests.** Create `src-tauri/src/modules/usage/claude.rs` with a test module:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_oauth_token() {
        let json = r#"{"claudeAiOauth":{"accessToken":"sk-tok-123","refreshToken":"r"}}"#;
        assert_eq!(parse_claude_creds(json).as_deref(), Some("sk-tok-123"));
    }

    #[test]
    fn missing_token_is_none() {
        assert!(parse_claude_creds(r#"{"other":true}"#).is_none());
    }

    #[test]
    fn parses_three_windows_account_and_plan() {
        let body: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/claude_usage.json")).unwrap();
        let (windows, account, plan) = parse_claude_usage(&body);
        let labels: Vec<_> = windows.iter().map(|w| w.label.as_str()).collect();
        assert_eq!(labels, vec!["5h", "Weekly", "Fable"]);
        assert_eq!(windows[0].used_pct, 38.0);
        assert_eq!(account.as_deref(), Some("user@example.com"));
        assert_eq!(plan.as_deref(), Some("max"));
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**
Run: `cd src-tauri && cargo test usage::claude`
Expected: compile-fail (functions missing).

- [ ] **Step 5: Write the implementation.** In `claude.rs`, above the tests. (Field names below match the Task 1 fixture — if the spike captured different names, update fixture + these accessors together.)
```rust
use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage"; // confirmed in Task 1
const OAUTH_BETA: &str = "oauth-2025-04-20"; // confirmed in Task 1

pub fn parse_claude_creds(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json).ok()?;
    v.get("claudeAiOauth")?
        .get("accessToken")?
        .as_str()
        .map(str::to_string)
}

fn window(body: &Value, key: &str, label: &str) -> Option<QuotaWindow> {
    let node = body.get(key)?;
    Some(QuotaWindow {
        label: label.to_string(),
        used_pct: node.get("utilization")?.as_f64()? as f32,
        resets_at: node.get("resets_at").and_then(Value::as_i64).map(|s| s * 1000),
    })
}

pub fn parse_claude_usage(body: &Value) -> (Vec<QuotaWindow>, Option<String>, Option<String>) {
    let windows = [
        ("five_hour", "5h"),
        ("seven_day", "Weekly"),
        ("seven_day_opus", "Fable"),
    ]
    .iter()
    .filter_map(|(k, l)| window(body, k, l))
    .collect();
    let account = body
        .get("account")
        .and_then(|a| a.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let plan = body
        .get("account")
        .and_then(|a| a.get("plan"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (windows, account, plan)
}

// Read the OAuth token from Keychain (macOS) or the credentials file (Linux/Windows).
fn read_token() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
            .ok()?;
        if out.status.success() {
            return parse_claude_creds(String::from_utf8_lossy(&out.stdout).trim());
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        let path = dirs::home_dir()?.join(".claude/.credentials.json");
        parse_claude_creds(&std::fs::read_to_string(path).ok()?)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn usage(status: UsageStatus, windows: Vec<QuotaWindow>, account: Option<String>, plan: Option<String>) -> ProviderUsage {
    ProviderUsage { provider: "claude".into(), status, account, plan, windows, fetched_at: now_ms() }
}

pub fn fetch_claude() -> ProviderUsage {
    let Some(token) = read_token() else {
        return usage(UsageStatus::SignedOut, vec![], None, None);
    };
    let resp = reqwest::blocking::Client::new()
        .get(USAGE_URL)
        .bearer_auth(&token)
        .header("anthropic-beta", OAUTH_BETA)
        .send();
    match resp {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
            usage(UsageStatus::AuthExpired, vec![], None, None)
        }
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_claude_usage(&body);
                usage(status_from_windows(&windows), windows, account, plan)
            }
            Err(_) => usage(UsageStatus::Unavailable, vec![], None, None),
        },
        _ => usage(UsageStatus::Unavailable, vec![], None, None),
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**
Run: `cd src-tauri && cargo test usage::claude`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/modules/usage
git commit -m "feat(usage): claude source (creds, fetch, parse)"
```

---

### Task 4: Codex usage source (creds + fetch + parse)

**Files:**
- Create: `src-tauri/src/modules/usage/codex.rs`
- Modify: `src-tauri/src/modules/usage/mod.rs` (add `mod codex;`)

**Interfaces:**
- Consumes: `QuotaWindow`, `ProviderUsage`, `UsageStatus`, `status_from_windows` from Task 2.
- Produces:
  - `pub struct CodexCreds { pub access_token: String, pub account_id: Option<String> }`
  - `pub fn parse_codex_creds(json: &str) -> Option<CodexCreds>`
  - `pub fn parse_codex_usage(body: &serde_json::Value, now_ms: i64) -> (Vec<QuotaWindow>, Option<String>)`
  - `pub fn fetch_codex() -> ProviderUsage`

- [ ] **Step 1: Declare the submodule.** In `src-tauri/src/modules/usage/mod.rs`:
```rust
mod codex;
pub use codex::fetch_codex;
```

- [ ] **Step 2: Write the failing tests.** Create `src-tauri/src/modules/usage/codex.rs` with:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_token_and_account() {
        let json = r#"{"tokens":{"access_token":"at-9","account_id":"acc-1"}}"#;
        let c = parse_codex_creds(json).unwrap();
        assert_eq!(c.access_token, "at-9");
        assert_eq!(c.account_id.as_deref(), Some("acc-1"));
    }

    #[test]
    fn missing_token_is_none() {
        assert!(parse_codex_creds(r#"{"tokens":{}}"#).is_none());
    }

    #[test]
    fn parses_session_window_with_reset() {
        let body: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/codex_usage.json")).unwrap();
        let (windows, account) = parse_codex_usage(&body, 1_000_000);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "5h");
        assert_eq!(windows[0].used_pct, 26.0);
        // now_ms + resets_in_seconds*1000 = 1_000_000 + 507600*1000
        assert_eq!(windows[0].resets_at, Some(1_000_000 + 507_600 * 1000));
        assert_eq!(account.as_deref(), Some("user@example.com"));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**
Run: `cd src-tauri && cargo test usage::codex`
Expected: compile-fail.

- [ ] **Step 4: Write the implementation.** In `codex.rs`, above the tests:
```rust
use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage"; // confirmed in Task 1

pub struct CodexCreds {
    pub access_token: String,
    pub account_id: Option<String>,
}

pub fn parse_codex_creds(json: &str) -> Option<CodexCreds> {
    let v: Value = serde_json::from_str(json).ok()?;
    let tokens = v.get("tokens")?;
    Some(CodexCreds {
        access_token: tokens.get("access_token")?.as_str()?.to_string(),
        account_id: tokens.get("account_id").and_then(Value::as_str).map(str::to_string),
    })
}

pub fn parse_codex_usage(body: &Value, now_ms: i64) -> (Vec<QuotaWindow>, Option<String>) {
    let mut windows = Vec::new();
    if let Some(p) = body.get("primary") {
        if let Some(used) = p.get("used_percent").and_then(Value::as_f64) {
            let resets_at = p
                .get("resets_in_seconds")
                .and_then(Value::as_i64)
                .map(|s| now_ms + s * 1000);
            windows.push(QuotaWindow { label: "5h".into(), used_pct: used as f32, resets_at });
        }
    }
    let account = body
        .get("account")
        .and_then(|a| a.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (windows, account)
}

fn read_creds() -> Option<CodexCreds> {
    let path = dirs::home_dir()?.join(".codex/auth.json");
    parse_codex_creds(&std::fs::read_to_string(path).ok()?)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn usage(status: UsageStatus, windows: Vec<QuotaWindow>, account: Option<String>) -> ProviderUsage {
    ProviderUsage { provider: "codex".into(), status, account, plan: None, windows, fetched_at: now_ms() }
}

pub fn fetch_codex() -> ProviderUsage {
    let Some(creds) = read_creds() else {
        return usage(UsageStatus::SignedOut, vec![], None);
    };
    let mut req = reqwest::blocking::Client::new().get(USAGE_URL).bearer_auth(&creds.access_token);
    if let Some(id) = &creds.account_id {
        req = req.header("chatgpt-account-id", id);
    }
    match req.send() {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => usage(UsageStatus::AuthExpired, vec![], None),
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account) = parse_codex_usage(&body, now_ms());
                usage(status_from_windows(&windows), windows, account)
            }
            Err(_) => usage(UsageStatus::Unavailable, vec![], None),
        },
        _ => usage(UsageStatus::Unavailable, vec![], None),
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**
Run: `cd src-tauri && cargo test usage::codex`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/modules/usage
git commit -m "feat(usage): codex source (creds, fetch, parse)"
```

---

### Task 5: Cache state, backoff gate, and Tauri commands

**Files:**
- Modify: `src-tauri/src/modules/usage/mod.rs` (add state + commands)
- Modify: `src-tauri/src/lib.rs` (`.manage` + `generate_handler!`)

**Interfaces:**
- Consumes: `fetch_claude`, `fetch_codex`, `ProviderUsage`, `UsageStatus`, `next_backoff_ms`.
- Produces (Tauri commands):
  - `usage_snapshot() -> Vec<ProviderUsage>`
  - `usage_refresh(provider: String) -> ProviderUsage`
  - `usage_connect(provider: String) -> ProviderUsage`
  - `usage_disconnect(provider: String)`
- Produces state: `pub struct UsageState(Mutex<HashMap<String, Cached>>)` (implements `Default`).

- [ ] **Step 1: Write the failing test** for the backoff gate (pure). Add to the `tests` module in `mod.rs`:
```rust
#[test]
fn gate_blocks_until_next_allowed() {
    // fetch is allowed only when now >= next_allowed_at
    assert!(fetch_allowed(100, 0));    // no backoff set
    assert!(!fetch_allowed(100, 200)); // still backing off
    assert!(fetch_allowed(300, 200));  // window elapsed
}
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd src-tauri && cargo test usage::tests::gate_blocks_until_next_allowed`
Expected: compile-fail (`fetch_allowed` missing).

- [ ] **Step 3: Implement state, gate, and commands.** Add to `mod.rs`:
```rust
use std::collections::HashMap;
use std::sync::Mutex;

pub struct Cached {
    pub usage: ProviderUsage,
    pub connected: bool,
    pub failures: u32,
    pub next_allowed_at: i64,
}

#[derive(Default)]
pub struct UsageState(pub Mutex<HashMap<String, Cached>>);

pub fn fetch_allowed(now_ms: i64, next_allowed_at: i64) -> bool {
    now_ms >= next_allowed_at
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fetch_provider(provider: &str) -> ProviderUsage {
    match provider {
        "claude" => fetch_claude(),
        "codex" => fetch_codex(),
        _ => ProviderUsage {
            provider: provider.to_string(),
            status: UsageStatus::Unavailable,
            account: None,
            plan: None,
            windows: vec![],
            fetched_at: now_ms(),
        },
    }
}

fn do_refresh(state: &UsageState, provider: &str) -> ProviderUsage {
    let now = now_ms();
    {
        // Respect backoff: return cached snapshot without hitting the network.
        let map = state.0.lock().unwrap();
        if let Some(c) = map.get(provider) {
            if !fetch_allowed(now, c.next_allowed_at) {
                return c.usage.clone();
            }
        }
    }
    let usage = fetch_provider(provider);
    let failed = matches!(usage.status, UsageStatus::Unavailable);
    let mut map = state.0.lock().unwrap();
    let entry = map.entry(provider.to_string()).or_insert(Cached {
        usage: usage.clone(),
        connected: true,
        failures: 0,
        next_allowed_at: 0,
    });
    entry.connected = true;
    if failed {
        entry.failures = entry.failures.saturating_add(1);
        entry.next_allowed_at = now + next_backoff_ms(entry.failures);
    } else {
        entry.failures = 0;
        entry.next_allowed_at = 0;
    }
    entry.usage = usage.clone();
    usage
}

#[tauri::command]
pub fn usage_snapshot(state: tauri::State<UsageState>) -> Vec<ProviderUsage> {
    state
        .0
        .lock()
        .unwrap()
        .values()
        .filter(|c| c.connected)
        .map(|c| c.usage.clone())
        .collect()
}

#[tauri::command]
pub fn usage_refresh(provider: String, state: tauri::State<UsageState>) -> ProviderUsage {
    do_refresh(&state, &provider)
}

#[tauri::command]
pub fn usage_connect(provider: String, state: tauri::State<UsageState>) -> ProviderUsage {
    {
        let mut map = state.0.lock().unwrap();
        if let Some(c) = map.get_mut(&provider) {
            c.connected = true;
            c.next_allowed_at = 0; // allow an immediate fetch on explicit connect
        }
    }
    do_refresh(&state, &provider)
}

#[tauri::command]
pub fn usage_disconnect(provider: String, state: tauri::State<UsageState>) {
    state.0.lock().unwrap().remove(&provider);
}
```

- [ ] **Step 4: Register state and commands.** In `src-tauri/src/lib.rs`, add a `.manage` line next to the others (~line 226):
```rust
        .manage(modules::usage::UsageState::default())
```
and add to the `generate_handler!` list (next to the `agent_*` entries):
```rust
            modules::usage::usage_snapshot,
            modules::usage::usage_refresh,
            modules::usage::usage_connect,
            modules::usage::usage_disconnect,
```
(Confirm the exact `modules::` path matches how sibling commands like `agent_enable_hooks` are referenced in this file; match that style.)

- [ ] **Step 5: Run tests + build**
Run: `cd src-tauri && cargo test usage:: && cargo build`
Expected: tests PASS, build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/modules/usage/mod.rs src-tauri/src/lib.rs
git commit -m "feat(usage): cache state, backoff gate, and tauri commands"
```

---

### Task 6: Frontend types + formatting helpers

**Files:**
- Create: `src/modules/usage/lib/types.ts`
- Create: `src/modules/usage/lib/format.ts`
- Create: `src/modules/usage/lib/format.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `UsageStatus`, `QuotaWindow`, `ProviderUsage` TS types mirroring the Rust serde output.
  - `format.ts`: `orderByConstrained(windows)`, `formatReset(resetsAt, now?)`, `formatFreshness(fetchedAt, now?)`, `usedLabel(window)`.

- [ ] **Step 1: Write the types.** Create `src/modules/usage/lib/types.ts`:
```ts
export type UsageStatus =
  | "signed_out"
  | "loading"
  | "ok"
  | "limited"
  | "stale"
  | "unavailable"
  | "auth_expired";

export type QuotaWindow = {
  label: string;
  used_pct: number;
  resets_at: number | null;
};

export type ProviderUsage = {
  provider: string;
  status: UsageStatus;
  account: string | null;
  plan: string | null;
  windows: QuotaWindow[];
  fetched_at: number;
};
```

- [ ] **Step 2: Write the failing tests.** Create `src/modules/usage/lib/format.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify they fail**
Run: `npx vitest run src/modules/usage/lib/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement.** Create `src/modules/usage/lib/format.ts`:
```ts
import type { QuotaWindow } from "./types";

export function orderByConstrained(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort((a, b) => b.used_pct - a.used_pct);
}

export function usedLabel(window: QuotaWindow): string {
  return `${Math.round(window.used_pct)}% used ${window.label}`;
}

export function formatReset(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return "";
  const secs = Math.max(0, Math.floor((resetsAt - now) / 1000));
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `Resets in ${d}d ${h}h`;
  if (h > 0) return `Resets in ${h}h ${m}m`;
  return `Resets in ${m}m`;
}

export function formatFreshness(fetchedAt: number, now = Date.now()): string {
  const mins = Math.floor((now - fetchedAt) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `Updated ${hrs}h ago`;
}
```

- [ ] **Step 5: Run to verify they pass**
Run: `npx vitest run src/modules/usage/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/modules/usage/lib
git commit -m "feat(usage): frontend types and formatting helpers"
```

---

### Task 7: Zustand store with refresh triggers

**Files:**
- Create: `src/modules/usage/store/usageStore.ts`
- Create: `src/modules/usage/index.ts`

**Interfaces:**
- Consumes: `ProviderUsage` (types), `invoke` from `@tauri-apps/api/core`.
- Produces `useUsageStore` with: `providers: ProviderUsage[]`, `refreshAll()`, `refresh(provider)`, `connect(provider)`, `disconnect(provider)`, `startAutoRefresh()` (returns cleanup), and a derived staleness marker applied in a selector.
- `STALE_AFTER_MS` and `BACKGROUND_INTERVAL_MS` constants.
- `index.ts` re-exports `UsageStatusBar` (Task 8) and `useUsageStore`.

- [ ] **Step 1: Implement the store.** Create `src/modules/usage/store/usageStore.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ProviderUsage } from "../lib/types";

export const V1_PROVIDERS = ["claude", "codex"] as const;
export const STALE_AFTER_MS = 15 * 60_000;
export const BACKGROUND_INTERVAL_MS = 5 * 60_000;

type UsageStoreState = {
  providers: ProviderUsage[];
  refreshAll: () => Promise<void>;
  refresh: (provider: string) => Promise<void>;
  connect: (provider: string) => Promise<void>;
  disconnect: (provider: string) => Promise<void>;
  startAutoRefresh: () => () => void;
};

// Client-side staleness overlay: mark Ok/Limited snapshots stale once old.
export function withStaleness(p: ProviderUsage, now = Date.now()): ProviderUsage {
  const fresh = now - p.fetched_at < STALE_AFTER_MS;
  if (fresh || p.status === "signed_out" || p.status === "loading") return p;
  if (p.status === "ok" || p.status === "limited") return { ...p, status: "stale" };
  return p;
}

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  providers: [],

  refreshAll: async () => {
    const snap = await invoke<ProviderUsage[]>("usage_snapshot").catch(() => []);
    set({ providers: snap.map((p) => withStaleness(p)) });
  },

  refresh: async (provider) => {
    const updated = await invoke<ProviderUsage>("usage_refresh", { provider }).catch(
      () => null,
    );
    if (!updated) return;
    set((s) => ({
      providers: mergeProvider(s.providers, withStaleness(updated)),
    }));
  },

  connect: async (provider) => {
    const updated = await invoke<ProviderUsage>("usage_connect", { provider }).catch(
      () => null,
    );
    if (!updated) return;
    set((s) => ({ providers: mergeProvider(s.providers, withStaleness(updated)) }));
  },

  disconnect: async (provider) => {
    await invoke("usage_disconnect", { provider }).catch(() => {});
    set((s) => ({ providers: s.providers.filter((p) => p.provider !== provider) }));
  },

  startAutoRefresh: () => {
    void get().refreshAll();
    const id = setInterval(() => {
      for (const p of get().providers) void get().refresh(p.provider);
    }, BACKGROUND_INTERVAL_MS);
    return () => clearInterval(id);
  },
}));

function mergeProvider(list: ProviderUsage[], next: ProviderUsage): ProviderUsage[] {
  const rest = list.filter((p) => p.provider !== next.provider);
  return [...rest, next];
}
```

- [ ] **Step 2: Create the module barrel.** Create `src/modules/usage/index.ts`:
```ts
export { UsageStatusBar } from "./UsageStatusBar";
export { useUsageStore } from "./store/usageStore";
```

- [ ] **Step 3: Typecheck**
Run: `npx tsc --noEmit` (expect one error: `UsageStatusBar` not yet created — resolved in Task 8. If your build fails hard on this, temporarily comment the export and restore in Task 8.)

- [ ] **Step 4: Commit**
```bash
git add src/modules/usage/store src/modules/usage/index.ts
git commit -m "feat(usage): zustand store with refresh + backoff-gated triggers"
```

---

### Task 8: Status-bar item + wire into StatusBar

**Files:**
- Create: `src/modules/usage/UsageStatusBar.tsx`
- Create: `src/modules/usage/ProviderChip.tsx`
- Modify: `src/modules/statusbar/StatusBar.tsx` (render `<UsageStatusBar/>` far right)

**Interfaces:**
- Consumes: `useUsageStore`, `orderByConstrained`, `usedLabel`, `AgentIcon` (`@/modules/agents/lib/agentIcon`), `RefreshIcon` from `@hugeicons/core-free-icons`.
- Produces: `UsageStatusBar` (renders one `ProviderChip` per connected provider; nothing when empty). `ProviderChip` opens the popover (Task 9).

- [ ] **Step 1: Build the chip.** Create `src/modules/usage/ProviderChip.tsx`:
```tsx
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProviderUsage } from "./lib/types";
import { orderByConstrained, usedLabel } from "./lib/format";
import { useUsageStore } from "./store/usageStore";

function barColor(status: ProviderUsage["status"]): string {
  if (status === "limited") return "bg-amber-500";
  if (status === "stale") return "bg-muted-foreground/40";
  return "bg-emerald-500";
}

export function ProviderChip({ usage }: { usage: ProviderUsage }) {
  const refresh = useUsageStore((s) => s.refresh);
  const ordered = orderByConstrained(usage.windows);
  const top = ordered[0];

  const text =
    usage.status === "unavailable"
      ? "Usage unavailable"
      : usage.status === "auth_expired"
        ? "Sign in again"
        : usage.status === "loading"
          ? "Loading…"
          : usage.status === "limited"
            ? "Limited"
            : ordered.map(usedLabel).join(" · ");

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px]">
      <AgentIcon agent={usage.provider} size={12} />
      {top ? (
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted">
          <span
            className={`absolute inset-y-0 left-0 ${barColor(usage.status)}`}
            style={{ width: `${Math.min(100, Math.max(0, top.used_pct))}%` }}
          />
        </span>
      ) : null}
      <span className="whitespace-nowrap text-muted-foreground">{text}</span>
      <button
        type="button"
        aria-label={`Refresh ${usage.provider} usage`}
        className="text-muted-foreground/70 hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          void refresh(usage.provider);
        }}
      >
        <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={2} />
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Build the container.** Create `src/modules/usage/UsageStatusBar.tsx` (popover wraps the chip in Task 9; for now render the chip directly):
```tsx
import { useUsageStore } from "./store/usageStore";
import { ProviderChip } from "./ProviderChip";

export function UsageStatusBar() {
  const providers = useUsageStore((s) => s.providers);
  const visible = providers.filter((p) => p.status !== "signed_out");
  if (visible.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-4">
      {visible.map((p) => (
        <ProviderChip key={p.provider} usage={p} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire into the status bar.** In `src/modules/statusbar/StatusBar.tsx`, import at top:
```tsx
import { UsageStatusBar } from "@/modules/usage";
```
and add it as the last child of the `<footer>`, **after** the closing `</div>` of the `flex-1` container (so it pins right):
```tsx
        </div>
        <UsageStatusBar />
      </footer>
```

- [ ] **Step 4: Typecheck + build**
Run: `npx tsc --noEmit && npm run build` (or the project's build script)
Expected: passes.

- [ ] **Step 5: Manual check.** Run the app (`npm run tauri dev` or project equivalent). With a Codex/Claude login present, connect (temporarily call `useUsageStore.getState().connect("codex")` from devtools) and confirm a chip appears bottom-right with a bar + `% used`. Confirm nothing shows when no provider is connected.

- [ ] **Step 6: Commit**
```bash
git add src/modules/usage/UsageStatusBar.tsx src/modules/usage/ProviderChip.tsx src/modules/statusbar/StatusBar.tsx
git commit -m "feat(usage): status-bar chip and wiring"
```

---

### Task 9: Detail popover (windows, account, disconnect)

**Files:**
- Create: `src/modules/usage/UsagePopover.tsx`
- Modify: `src/modules/usage/ProviderChip.tsx` (wrap trigger in popover)

**Interfaces:**
- Consumes: shadcn `Popover`/`PopoverTrigger`/`PopoverContent`/`PopoverHeader`/`PopoverTitle` from `@/components/ui/popover`; `formatReset`, `formatFreshness`, `usedLabel`, `orderByConstrained`; `useUsageStore`.
- Produces: `UsagePopover` that renders the full detail card from a `ProviderUsage`.

- [ ] **Step 1: Build the popover body.** Create `src/modules/usage/UsagePopover.tsx`:
```tsx
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import type { ProviderUsage } from "./lib/types";
import { formatFreshness, formatReset, orderByConstrained, usedLabel } from "./lib/format";
import { useUsageStore } from "./store/usageStore";

export function UsagePopover({ usage }: { usage: ProviderUsage }) {
  const disconnect = useUsageStore((s) => s.disconnect);
  const name = usage.provider === "claude" ? "Claude" : usage.provider === "codex" ? "Codex" : usage.provider;
  return (
    <div className="w-64 text-[11px]">
      <div className="mb-2 flex items-center gap-2">
        <AgentIcon agent={usage.provider} size={16} />
        <div>
          <div className="font-medium capitalize">{name}</div>
          <div className="text-muted-foreground">{formatFreshness(usage.fetched_at)}</div>
        </div>
      </div>

      {usage.status === "unavailable" ? (
        <p className="py-2 text-muted-foreground">Usage unavailable for this provider.</p>
      ) : usage.status === "auth_expired" ? (
        <p className="py-2 text-muted-foreground">Login expired — sign in again in the CLI.</p>
      ) : (
        <div className="space-y-2 border-t border-border/60 py-2">
          {orderByConstrained(usage.windows).map((w) => (
            <div key={w.label}>
              <div className="flex items-center justify-between">
                <span>{usedLabel(w)}</span>
                <span className="text-muted-foreground">{formatReset(w.resets_at)}</span>
              </div>
              <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(0, w.used_pct))}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border/60 pt-2">
        {usage.plan ? <div className="capitalize text-muted-foreground">Plan: {usage.plan}</div> : null}
        {usage.account ? <div className="text-muted-foreground">{usage.account}</div> : null}
        <button
          type="button"
          className="mt-1 text-muted-foreground hover:text-foreground"
          onClick={() => void disconnect(usage.provider)}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wrap the chip in a popover.** In `src/modules/usage/ProviderChip.tsx`, import:
```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UsagePopover } from "./UsagePopover";
```
Wrap the returned `<span>` so the chip is the trigger:
```tsx
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10.5px]">
          {/* existing icon + bar + text + refresh button unchanged */}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="p-3">
        <UsagePopover usage={usage} />
      </PopoverContent>
    </Popover>
  );
```
(Keep the refresh button's `e.stopPropagation()` so it doesn't toggle the popover.)

- [ ] **Step 3: Typecheck + build**
Run: `npx tsc --noEmit && npm run build`
Expected: passes.

- [ ] **Step 4: Manual check.** Click a chip → popover shows each window with its bar + reset, the account email, plan (Claude), "Updated …", and a working Disconnect that removes the chip.

- [ ] **Step 5: Commit**
```bash
git add src/modules/usage
git commit -m "feat(usage): detail popover with windows, account, disconnect"
```

---

### Task 10: Startup + focus refresh wiring

**Files:**
- Modify: `src/app/App.tsx` (start auto-refresh + refresh on focus)

**Interfaces:**
- Consumes: `useUsageStore` (`startAutoRefresh`, `refreshAll`, `connect`), `useWindowFocus` (`@/modules/agents/lib/useWindowFocus`).

- [ ] **Step 1: Auto-connect known logins on startup + start the interval.** In `src/app/App.tsx`, add an effect (near other top-level effects) that connects the v1 providers once at mount and starts the background interval:
```tsx
useEffect(() => {
  const { connect, startAutoRefresh } = useUsageStore.getState();
  for (const p of ["claude", "codex"]) void connect(p);
  return startAutoRefresh();
}, []);
```
(`connect` fetches once; providers with no login resolve to `signed_out` and render nothing. This is the app-start refresh trigger.)

- [ ] **Step 2: Refresh on window focus.** Add:
```tsx
const focused = useWindowFocus();
useEffect(() => {
  if (focused) void useUsageStore.getState().refreshAll();
}, [focused]);
```
(`refreshAll` reads the cache cheaply; backoff still gates any real network calls triggered elsewhere.)

- [ ] **Step 3: Typecheck + build**
Run: `npx tsc --noEmit && npm run build`
Expected: passes.

- [ ] **Step 4: Manual check.** Launch the app: a chip appears within a few seconds if a Claude/Codex login exists. Blur/refocus the window → freshness updates. Leave it idle > the interval → it refreshes without spamming (watch for no rapid repeated network calls on a provider that errored, confirming backoff).

- [ ] **Step 5: Commit**
```bash
git add src/app/App.tsx
git commit -m "feat(usage): app-start + focus refresh wiring"
```

---

## Self-Review

**Spec coverage:**
- Far-right placement → Task 8 (after `flex-1` container). ✓
- Reuse CLI logins (Claude Keychain/file, Codex file) → Tasks 3–4. ✓
- Claude + Codex first → Tasks 3–4; v1 constraint. ✓
- Show "used", quota type + reset → Tasks 3–4 (windows + resets_at), 6 (`formatReset`, `usedLabel`). ✓
- All 7 states → `UsageStatus` (Task 2); rendered in chip (Task 8) + popover (Task 9); `stale` overlay (Task 7 `withStaleness`). ✓
- Refresh on login/start/manual/background → Task 10 (connect+interval), Task 8 (manual button), Task 7 (interval). ✓
- Backoff after rate limits/errors → Task 5 (`next_backoff_ms`, gate in `do_refresh`). ✓
- Hidden when no provider connected → Task 8 (`visible.length === 0` → null). ✓
- Disconnect/account switching → Task 9 (Disconnect); command Task 5. ✓
- Security: tokens in memory only, never persisted/logged → Tasks 3–5 (no writes; only read on demand). ✓
- Prefer documented APIs / "Usage unavailable" fallback → Task 1 spike + `Unavailable` status everywhere. ✓
- Tests: parsing, selector, backoff, formatters → Tasks 2, 3, 4, 6. ✓

**Placeholder scan:** No `TBD`/`TODO`; endpoint URLs are marked "confirmed in Task 1" and the spike explicitly resolves/updates them. Representative fixtures are labeled and their parser field names travel with them.

**Type consistency:** `used_pct`, `resets_at`, `fetched_at`, `provider`, `status`, `windows`, `account`, `plan` match across Rust (serde) and the TS `ProviderUsage`. `UsageStatus` snake_case values identical on both sides. Command names (`usage_snapshot/refresh/connect/disconnect`) match between Task 5 (Rust) and Task 7 (invoke).

## Known risk

The whole feature depends on two undocumented endpoints. Task 1 is a hard gate: if a provider's endpoint can't be confirmed, it ships in `Unavailable` and the rest of the plan still produces a working, correct indicator for the other provider.
