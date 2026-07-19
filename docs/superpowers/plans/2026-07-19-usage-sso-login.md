# Usage SSO Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CLI-credential reuse with Pide's own browser OAuth (PKCE) login per provider (Codex + Claude), storing tokens Pide owns in the OS keychain and refreshing them itself.

**Architecture:** New Rust `oauth` module owns the PKCE flow (loopback callback for Codex, code-paste for Claude), token exchange/refresh, and keychain storage. The usage fetchers load Pide's stored tokens (refresh + persist on expiry) instead of the CLIs' files. A Settings "Accounts" section drives login/logout.

**Tech Stack:** Rust/Tauri v2 (sync + async `#[tauri::command]`), `reqwest` (blocking), `keyring`, `sha2`, `base64`, `getrandom`; React/TS, Zustand, `@tauri-apps/plugin-opener`.

## Global Constraints

- **Tokens live only in the OS keychain** (`keyring`, service `pide-usage-<provider>`, user `tokens`). Never in settings/files/logs. Pide owns them; refreshing persists the new tokens back to the keychain.
- **Provider values:** `"codex"`, `"claude"`.
- **Confirmed OAuth params (use verbatim):**
  - Codex: authorize `https://auth.openai.com/oauth/authorize`, token `https://auth.openai.com/oauth/token`, client_id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback`, scope `openid profile email offline_access`, loopback port `1455`, no special UA.
  - Claude: authorize `https://platform.claude.com/oauth/authorize`, token `https://platform.claude.com/v1/oauth/token`, client_id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, redirect `https://platform.claude.com/oauth/code/callback` (manual paste), scope `user:profile user:inference offline_access`, User-Agent `claude-code/2.1.207` (Cloudflare-gated host).
- **PKCE:** S256, `code_challenge = base64url_nopad(sha256(code_verifier))`.
- **Usage endpoints/parsing unchanged:** Codex `GET https://chatgpt.com/backend-api/codex/usage` (+ `chatgpt-account-id`, UA `codex_cli_rs`); Claude `GET https://api.anthropic.com/api/oauth/usage` (+ `anthropic-beta: oauth-2025-04-20`). Keep the existing `parse_codex_usage`/`parse_claude_usage` + window logic.
- **SSO-only:** delete `~/.codex/auth.json` reading and Claude `Claude Code-credentials` Keychain/file reading; our tokens are the only source.
- Rust commands registered in `src-tauri/src/lib.rs` + module in `src-tauri/src/modules/mod.rs`, matching the `agent`/`usage` pattern.
- Commit after every green step.

---

### Task 1: OAuth dependencies, PKCE, provider registry

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/modules/mod.rs` (add `pub mod oauth;`)
- Create: `src-tauri/src/modules/oauth/mod.rs` (module root; provider registry + PKCE here for now)

**Interfaces:**
- Produces:
  - `pub struct Pkce { pub verifier: String, pub challenge: String }`
  - `pub fn pkce() -> Pkce`, `pub fn random_urlsafe(n_bytes: usize) -> String`
  - `pub struct ProviderConfig { pub id: &'static str, pub authorize_url: &'static str, pub token_url: &'static str, pub client_id: &'static str, pub redirect_uri: &'static str, pub scope: &'static str, pub user_agent: Option<&'static str>, pub loopback_port: Option<u16> }`
  - `pub fn provider_config(provider: &str) -> Option<ProviderConfig>`
  - `pub fn authorize_url(cfg: &ProviderConfig, challenge: &str, state: &str) -> String`

- [ ] **Step 1: Add dependencies.** In `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
keyring = "3"
sha2 = "0.10"
base64 = "0.22"
getrandom = "0.2"
```
Run: `cd src-tauri && cargo build` — Expected: builds (downloads crates).

- [ ] **Step 2: Declare the module.** In `src-tauri/src/modules/mod.rs` add (alphabetical, after `lsp`):
```rust
pub mod oauth;
```

- [ ] **Step 3: Write the failing tests.** Create `src-tauri/src/modules/oauth/mod.rs` with a test module:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let p = pkce();
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier.as_bytes()));
        assert_eq!(p.challenge, expected);
        assert!(p.verifier.len() >= 43); // RFC 7636 min
    }

    #[test]
    fn random_urlsafe_has_no_padding_and_varies() {
        let a = random_urlsafe(24);
        let b = random_urlsafe(24);
        assert!(!a.contains('=') && !a.contains('+') && !a.contains('/'));
        assert_ne!(a, b);
    }

    #[test]
    fn codex_config_and_authorize_url() {
        let cfg = provider_config("codex").unwrap();
        assert_eq!(cfg.loopback_port, Some(1455));
        let url = authorize_url(&cfg, "CHAL", "STATE");
        assert!(url.starts_with("https://auth.openai.com/oauth/authorize?"));
        assert!(url.contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
        assert!(url.contains("code_challenge=CHAL"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=STATE"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"));
    }

    #[test]
    fn claude_config_is_manual_paste() {
        let cfg = provider_config("claude").unwrap();
        assert_eq!(cfg.loopback_port, None);
        assert_eq!(cfg.user_agent, Some("claude-code/2.1.207"));
    }

    #[test]
    fn unknown_provider_is_none() {
        assert!(provider_config("gemini").is_none());
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**
Run: `cd src-tauri && cargo test oauth::`
Expected: compile-fail (items missing).

- [ ] **Step 5: Implement.** Above the tests in `mod.rs`:
```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

pub fn random_urlsafe(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    getrandom::getrandom(&mut buf).expect("system RNG");
    URL_SAFE_NO_PAD.encode(buf)
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Pkce {
    let verifier = random_urlsafe(48); // 64 url-safe chars
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce { verifier, challenge }
}

pub struct ProviderConfig {
    pub id: &'static str,
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub client_id: &'static str,
    pub redirect_uri: &'static str,
    pub scope: &'static str,
    pub user_agent: Option<&'static str>,
    pub loopback_port: Option<u16>,
}

pub fn provider_config(provider: &str) -> Option<ProviderConfig> {
    match provider {
        "codex" => Some(ProviderConfig {
            id: "codex",
            authorize_url: "https://auth.openai.com/oauth/authorize",
            token_url: "https://auth.openai.com/oauth/token",
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
            redirect_uri: "http://localhost:1455/auth/callback",
            scope: "openid profile email offline_access",
            user_agent: None,
            loopback_port: Some(1455),
        }),
        "claude" => Some(ProviderConfig {
            id: "claude",
            authorize_url: "https://platform.claude.com/oauth/authorize",
            token_url: "https://platform.claude.com/v1/oauth/token",
            client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            redirect_uri: "https://platform.claude.com/oauth/code/callback",
            scope: "user:profile user:inference offline_access",
            user_agent: Some("claude-code/2.1.207"),
            loopback_port: None,
        }),
        _ => None,
    }
}

fn enc(s: &str) -> String {
    // minimal application/x-www-form-urlencoded component encoding
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn authorize_url(cfg: &ProviderConfig, challenge: &str, state: &str) -> String {
    format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        cfg.authorize_url,
        enc(cfg.client_id),
        enc(cfg.redirect_uri),
        enc(cfg.scope),
        enc(challenge),
        enc(state),
    )
}
```

- [ ] **Step 6: Run tests to verify they pass**
Run: `cd src-tauri && cargo test oauth::`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/modules/mod.rs src-tauri/src/modules/oauth
git commit -m "feat(oauth): deps, PKCE, provider registry, authorize URL"
```

---

### Task 2: Keychain token store

**Files:**
- Create: `src-tauri/src/modules/oauth/store.rs`
- Modify: `src-tauri/src/modules/oauth/mod.rs` (add `pub mod store;`)

**Interfaces:**
- Produces:
  - `pub struct Tokens { pub access: String, pub refresh: String, pub expires_at: i64, pub account: Option<String> }` (derives `Clone, Serialize, Deserialize`)
  - `pub fn save(provider: &str, t: &Tokens) -> bool`
  - `pub fn load(provider: &str) -> Option<Tokens>`
  - `pub fn delete(provider: &str)`
  - `pub fn is_expired(t: &Tokens, now_ms: i64) -> bool`

- [ ] **Step 1: Declare the submodule.** In `src-tauri/src/modules/oauth/mod.rs`:
```rust
pub mod store;
```

- [ ] **Step 2: Write the failing tests.** Create `src-tauri/src/modules/oauth/store.rs` with:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_json_round_trip() {
        let t = Tokens {
            access: "a".into(),
            refresh: "r".into(),
            expires_at: 1_784_000_000_000,
            account: Some("u@e.com".into()),
        };
        let s = serde_json::to_string(&t).unwrap();
        let back: Tokens = serde_json::from_str(&s).unwrap();
        assert_eq!(back.access, "a");
        assert_eq!(back.refresh, "r");
        assert_eq!(back.expires_at, 1_784_000_000_000);
        assert_eq!(back.account.as_deref(), Some("u@e.com"));
    }

    #[test]
    fn expiry_uses_60s_skew() {
        let t = Tokens { access: "a".into(), refresh: "r".into(), expires_at: 1_000_000, account: None };
        assert!(!is_expired(&t, 900_000));           // 100s before expiry -> fresh
        assert!(is_expired(&t, 1_000_000 - 30_000)); // within 60s skew -> treat expired
        assert!(is_expired(&t, 1_100_000));          // past expiry
    }
}
```

- [ ] **Step 3: Run to verify it fails**
Run: `cd src-tauri && cargo test oauth::store`
Expected: compile-fail.

- [ ] **Step 4: Implement.** Above the tests:
```rust
use serde::{Deserialize, Serialize};

const SERVICE_PREFIX: &str = "pide-usage-";
const USER: &str = "tokens";
const EXPIRY_SKEW_MS: i64 = 60_000;

#[derive(Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    pub expires_at: i64, // unix ms
    pub account: Option<String>,
}

pub fn is_expired(t: &Tokens, now_ms: i64) -> bool {
    now_ms >= t.expires_at - EXPIRY_SKEW_MS
}

fn entry(provider: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(&format!("{SERVICE_PREFIX}{provider}"), USER).ok()
}

pub fn save(provider: &str, t: &Tokens) -> bool {
    let Some(e) = entry(provider) else { return false };
    let Ok(json) = serde_json::to_string(t) else { return false };
    e.set_password(&json).is_ok()
}

pub fn load(provider: &str) -> Option<Tokens> {
    let json = entry(provider)?.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

pub fn delete(provider: &str) {
    if let Some(e) = entry(provider) {
        let _ = e.delete_credential();
    }
}
```

- [ ] **Step 5: Run to verify it passes**
Run: `cd src-tauri && cargo test oauth::store`
Expected: PASS. (Keychain I/O is not unit-tested; the serde + expiry logic is.)

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/modules/oauth/store.rs src-tauri/src/modules/oauth/mod.rs
git commit -m "feat(oauth): keychain token store"
```

---

### Task 3: Token exchange + refresh (+ email from id_token)

**Files:**
- Create: `src-tauri/src/modules/oauth/token.rs`
- Modify: `src-tauri/src/modules/oauth/mod.rs` (add `pub mod token;`)

**Interfaces:**
- Consumes: `ProviderConfig` (Task 1), `Tokens` (Task 2).
- Produces:
  - `pub fn exchange_code(cfg: &ProviderConfig, code: &str, verifier: &str) -> Option<Tokens>`
  - `pub fn refresh(cfg: &ProviderConfig, refresh_token: &str) -> Option<Tokens>`
  - `pub fn email_from_id_token(id_token: &str) -> Option<String>` (decodes the JWT payload's `email` claim)

- [ ] **Step 1: Declare the submodule.** In `mod.rs`:
```rust
pub mod token;
```

- [ ] **Step 2: Write the failing test** (the JWT-claim decode is the pure, testable part). Create `src-tauri/src/modules/oauth/token.rs` with:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    #[test]
    fn email_extracted_from_jwt_payload() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"user@example.com","sub":"x"}"#);
        let jwt = format!("header.{payload}.sig");
        assert_eq!(email_from_id_token(&jwt).as_deref(), Some("user@example.com"));
    }

    #[test]
    fn email_none_when_malformed() {
        assert!(email_from_id_token("not-a-jwt").is_none());
    }
}
```

- [ ] **Step 3: Run to verify it fails**
Run: `cd src-tauri && cargo test oauth::token`
Expected: compile-fail.

- [ ] **Step 4: Implement.** Above the tests:
```rust
use super::store::Tokens;
use super::ProviderConfig;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::time::Duration;

pub fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload_b64 = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email").and_then(Value::as_str).map(str::to_string)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn client(cfg: &ProviderConfig) -> Option<reqwest::blocking::Client> {
    let mut b = reqwest::blocking::Client::builder().timeout(Duration::from_secs(15));
    if let Some(ua) = cfg.user_agent {
        b = b.user_agent(ua);
    }
    b.build().ok()
}

fn tokens_from_response(body: &Value, prior_refresh: Option<&str>) -> Option<Tokens> {
    let access = body.get("access_token")?.as_str()?.to_string();
    // some refreshes omit a new refresh_token; keep the prior one then
    let refresh = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| prior_refresh.map(str::to_string))?;
    let expires_in = body.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    let account = body.get("id_token").and_then(Value::as_str).and_then(email_from_id_token);
    Some(Tokens { access, refresh, expires_at: now_ms() + expires_in * 1000, account })
}

pub fn exchange_code(cfg: &ProviderConfig, code: &str, verifier: &str) -> Option<Tokens> {
    let c = client(cfg)?;
    let resp = c
        .post(cfg.token_url)
        .json(&json!({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": cfg.redirect_uri,
            "client_id": cfg.client_id,
            "code_verifier": verifier,
        }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    tokens_from_response(&resp.json::<Value>().ok()?, None)
}

pub fn refresh(cfg: &ProviderConfig, refresh_token: &str) -> Option<Tokens> {
    let c = client(cfg)?;
    let resp = c
        .post(cfg.token_url)
        .json(&json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": cfg.client_id,
            "scope": cfg.scope,
        }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    tokens_from_response(&resp.json::<Value>().ok()?, Some(refresh_token))
}
```

- [ ] **Step 5: Run to verify it passes**
Run: `cd src-tauri && cargo test oauth::token`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/src/modules/oauth/token.rs src-tauri/src/modules/oauth/mod.rs
git commit -m "feat(oauth): token exchange + refresh + id_token email"
```

---

### Task 4: Loopback callback + login/logout commands

**Files:**
- Create: `src-tauri/src/modules/oauth/loopback.rs`
- Modify: `src-tauri/src/modules/oauth/mod.rs` (pending-login state + commands)
- Modify: `src-tauri/src/lib.rs` (register state + commands)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces (Tauri commands):
  - `usage_login(provider: String) -> Result<Option<String>, String>` — loopback providers (codex): open browser, wait for callback, exchange, save; returns account email.
  - `usage_login_start(provider: String) -> Result<String, String>` — paste providers (claude): returns authorize URL, stashes pkce+state.
  - `usage_login_finish(provider: String, code: String) -> Result<Option<String>, String>` — exchange the pasted code, save; returns email.
  - `usage_logout(provider: String)` — `store::delete`.
  - `usage_connected(provider: String) -> bool` — `store::load(..).is_some()`.
- Produces: `pub struct OauthState(pub Mutex<HashMap<String, Pending>>)` with `pub struct Pending { pub verifier: String, pub state: String }`.
- Loopback helper: `pub fn wait_for_code(port: u16, expected_state: &str, timeout: Duration) -> Option<String>` (parses `code`/`state` from the one callback request).

- [ ] **Step 1: Write the failing test** for the query parser (the pure part of the loopback). Create `src-tauri/src/modules/oauth/loopback.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_state_from_request_line() {
        let line = "GET /auth/callback?code=abc123&state=xyz HTTP/1.1";
        let (code, state) = parse_callback(line).unwrap();
        assert_eq!(code, "abc123");
        assert_eq!(state, "xyz");
    }

    #[test]
    fn none_without_code() {
        assert!(parse_callback("GET /auth/callback?state=xyz HTTP/1.1").is_none());
    }
}
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd src-tauri && cargo test oauth::loopback`
Expected: compile-fail.

- [ ] **Step 3: Implement the loopback.** Above the tests in `loopback.rs`:
```rust
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

pub fn parse_callback(request_line: &str) -> Option<(String, String)> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("code", v)) => code = Some(v.to_string()),
            Some(("state", v)) => state = Some(v.to_string()),
            _ => {}
        }
    }
    Some((code?, state?))
}

/// Accept exactly one callback request on 127.0.0.1:<port>, verify state,
/// return the code. Blocks up to `timeout`.
pub fn wait_for_code(port: u16, expected_state: &str, timeout: Duration) -> Option<String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).ok()?;
    listener.set_nonblocking(true).ok()?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).ok()?;
                let text = String::from_utf8_lossy(&buf[..n]);
                let first = text.lines().next().unwrap_or("");
                let result = parse_callback(first).filter(|(_, s)| s == expected_state);
                let body = if result.is_some() {
                    "Login complete. You can close this tab and return to Pide."
                } else {
                    "Login failed (state mismatch). You can close this tab."
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                if let Some((code, _)) = result {
                    return Some(code);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return None,
        }
    }
    None
}
```

- [ ] **Step 4: Run to verify parser passes**
Run: `cd src-tauri && cargo test oauth::loopback`
Expected: PASS.

- [ ] **Step 5: Add the pending-login state + commands.** In `src-tauri/src/modules/oauth/mod.rs` add:
```rust
pub mod loopback;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

pub struct Pending {
    pub verifier: String,
    pub state: String,
}

#[derive(Default)]
pub struct OauthState(pub Mutex<HashMap<String, Pending>>);

fn open_browser(app: &tauri::AppHandle, url: &str) {
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().open_url(url, None::<&str>);
}

/// Loopback login (Codex): open browser, wait for the callback, exchange, save.
#[tauri::command]
pub async fn usage_login(app: tauri::AppHandle, provider: String) -> Result<Option<String>, String> {
    let cfg = provider_config(&provider).ok_or("unknown provider")?;
    let port = cfg.loopback_port.ok_or("provider is not loopback; use usage_login_start")?;
    let p = pkce();
    let st = random_urlsafe(24);
    let url = authorize_url(&cfg, &p.challenge, &st);
    open_browser(&app, &url);
    // Wait for the callback + exchange off the async runtime.
    let verifier = p.verifier;
    let state = st;
    let provider2 = provider.clone();
    let tokens = tauri::async_runtime::spawn_blocking(move || {
        let cfg = provider_config(&provider2)?;
        let code = loopback::wait_for_code(port, &state, Duration::from_secs(120))?;
        token::exchange_code(&cfg, &code, &verifier)
    })
    .await
    .map_err(|e| e.to_string())?;
    let tokens = tokens.ok_or("login did not complete")?;
    store::save(&provider, &tokens);
    Ok(tokens.account)
}

/// Paste login step 1 (Claude): stash pkce+state, return the authorize URL.
#[tauri::command]
pub fn usage_login_start(provider: String, state: tauri::State<OauthState>) -> Result<String, String> {
    let cfg = provider_config(&provider).ok_or("unknown provider")?;
    let p = pkce();
    let st = random_urlsafe(24);
    let url = authorize_url(&cfg, &p.challenge, &st);
    state
        .0
        .lock()
        .unwrap()
        .insert(provider, Pending { verifier: p.verifier, state: st });
    Ok(url)
}

/// Paste login step 2 (Claude): exchange the pasted code with the stashed verifier.
#[tauri::command]
pub fn usage_login_finish(
    provider: String,
    code: String,
    state: tauri::State<OauthState>,
) -> Result<Option<String>, String> {
    let cfg = provider_config(&provider).ok_or("unknown provider")?;
    let pending = state.0.lock().unwrap().remove(&provider).ok_or("no pending login")?;
    let tokens = token::exchange_code(&cfg, code.trim(), &pending.verifier).ok_or("code exchange failed")?;
    store::save(&provider, &tokens);
    Ok(tokens.account)
}

#[tauri::command]
pub fn usage_logout(provider: String) {
    store::delete(&provider);
}

#[tauri::command]
pub fn usage_connected(provider: String) -> bool {
    store::load(&provider).is_some()
}
```

- [ ] **Step 6: Register in `src-tauri/src/lib.rs`.** Add to the `use modules::{...}` list: `oauth`. Add a `.manage(oauth::OauthState::default())` line near the other `.manage(...)`. Add to `generate_handler![...]`:
```rust
            oauth::usage_login,
            oauth::usage_login_start,
            oauth::usage_login_finish,
            oauth::usage_logout,
            oauth::usage_connected,
```
(Match sibling short-form style; confirm `tauri-plugin-opener` is initialized in the builder — it is, since the frontend uses `@tauri-apps/plugin-opener`.)

- [ ] **Step 7: Build + test**
Run: `cd src-tauri && cargo test oauth:: && cargo build`
Expected: tests PASS, crate builds.

- [ ] **Step 8: Commit**
```bash
git add src-tauri/src/modules/oauth src-tauri/src/lib.rs
git commit -m "feat(oauth): loopback callback + login/logout commands"
```

---

### Task 5: Point Codex usage at our tokens (remove auth.json reading)

**Files:**
- Modify: `src-tauri/src/modules/usage/codex.rs`

**Interfaces:**
- Consumes: `crate::modules::oauth::store::{load, save, is_expired, Tokens}`, `oauth::{provider_config, token::refresh}`.
- Keeps: `parse_codex_usage`, `label_for`, `short_name`, `window_from` and their tests (unchanged).
- Removes: `parse_codex_auth`, `read_auth`, `refresh_access_token`, `CLIENT_ID`, `TOKEN_URL`, `CodexAuth`, and their tests.

- [ ] **Step 1: Replace the auth/token plumbing.** In `codex.rs`, delete `CodexAuth`, `parse_codex_auth`, `read_auth`, `refresh_access_token`, the `CLIENT_ID`/`TOKEN_URL` consts, and the `parse_auth_*` tests. Keep `USAGE_URL`, `parse_codex_usage`, `label_for`, `short_name`, `window_from`, `usage`, `now_ms`, and their tests. Replace `fetch_codex` + add a token-acquiring helper:
```rust
use crate::modules::oauth;

// Get a usable access token: our stored one if fresh, else refresh (and persist).
fn access_token() -> Option<String> {
    let mut t = oauth::store::load("codex")?;
    if oauth::store::is_expired(&t, now_ms()) {
        let cfg = oauth::provider_config("codex")?;
        t = oauth::token::refresh(&cfg, &t.refresh)?;
        oauth::store::save("codex", &t);
    }
    Some(t.access)
}

pub fn fetch_codex() -> ProviderUsage {
    let Some(access) = access_token() else {
        // no stored tokens at all -> signed out; refresh failed -> auth expired
        return match oauth::store::load("codex") {
            Some(_) => usage(UsageStatus::AuthExpired, vec![], None, None),
            None => usage(UsageStatus::SignedOut, vec![], None, None),
        };
    };
    let account_id = None::<String>; // not needed; email comes from the usage body
    match fetch_usage(&access, &account_id) {
        Outcome::Ok(pu) => pu,
        Outcome::Unauthorized => usage(UsageStatus::AuthExpired, vec![], None, None),
        Outcome::Failed => usage(UsageStatus::Unavailable, vec![], None, None),
    }
}
```
Update `fetch_usage` to build its own client (it previously took a client): change its signature to `fn fetch_usage(access: &str, account_id: &Option<String>) -> Outcome` and build the client inside with a 10s timeout + `.user_agent("codex_cli_rs")`. Keep the header/parse body exactly as before. (The `chatgpt-account-id` header is optional now; pass `None`.)

- [ ] **Step 2: Build + run the retained parse tests**
Run: `cd src-tauri && cargo test usage::codex && cargo build`
Expected: the `parse`/`label`/`short_name` tests still PASS; crate builds with no unused-import warnings (remove `Duration`/`json` imports if now unused, keep what `fetch_usage` needs).

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/modules/usage/codex.rs
git commit -m "feat(usage): Codex uses Pide's own OAuth tokens (drop auth.json reuse)"
```

---

### Task 6: Point Claude usage at our tokens (remove Keychain/file reading)

**Files:**
- Modify: `src-tauri/src/modules/usage/claude.rs`

**Interfaces:**
- Consumes: `crate::modules::oauth::{store, provider_config, token::refresh}`.
- Keeps: `parse_claude_usage`, `window` helper + their tests (unchanged), `USAGE_URL`, `OAUTH_BETA`.
- Removes: `parse_claude_creds`, `read_token`, and the creds tests.

- [ ] **Step 1: Replace the token plumbing.** In `claude.rs`, delete `parse_claude_creds`, `read_token`, and the `extracts_oauth_token`/`missing_token_is_none` tests. Keep `parse_claude_usage`, `window`, `USAGE_URL`, `OAUTH_BETA`, `usage`, `now_ms`, and the `parses_three_windows_account_and_plan` test. Add the same token helper and rewrite `fetch_claude`:
```rust
use crate::modules::oauth;

fn access_token() -> Option<String> {
    let mut t = oauth::store::load("claude")?;
    if oauth::store::is_expired(&t, now_ms()) {
        let cfg = oauth::provider_config("claude")?;
        t = oauth::token::refresh(&cfg, &t.refresh)?;
        oauth::store::save("claude", &t);
    }
    Some(t.access)
}

pub fn fetch_claude() -> ProviderUsage {
    let Some(access) = access_token() else {
        return match oauth::store::load("claude") {
            Some(_) => usage(UsageStatus::AuthExpired, vec![], None, None),
            None => usage(UsageStatus::SignedOut, vec![], None, None),
        };
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("claude-code/2.1.207")
        .build()
    {
        Ok(c) => c,
        Err(_) => return usage(UsageStatus::Unavailable, vec![], None, None),
    };
    let resp = client
        .get(USAGE_URL)
        .bearer_auth(&access)
        .header("anthropic-beta", OAUTH_BETA)
        .send();
    match resp {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
            usage(UsageStatus::AuthExpired, vec![], None, None)
        }
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_claude_usage(&body);
                if windows.is_empty() {
                    usage(UsageStatus::Unavailable, vec![], account, plan)
                } else {
                    usage(status_from_windows(&windows), windows, account, plan)
                }
            }
            Err(_) => usage(UsageStatus::Unavailable, vec![], None, None),
        },
        _ => usage(UsageStatus::Unavailable, vec![], None, None),
    }
}
```

- [ ] **Step 2: Build + retained tests**
Run: `cd src-tauri && cargo test usage::claude && cargo build`
Expected: `parses_three_windows_account_and_plan` PASSES; builds clean (drop now-unused `dirs`-based code; keep `serde_json::Value` import).

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/modules/usage/claude.rs
git commit -m "feat(usage): Claude uses Pide's own OAuth tokens (drop CLI creds reuse)"
```

---

### Task 7: Settings "Accounts" section + store actions

**Files:**
- Create: `src/settings/sections/AccountsSection.tsx`
- Modify: `src/settings/SettingsApp.tsx` (add the "Accounts" tab)
- Modify: `src/modules/settings/openSettingsWindow.ts` (add `"accounts"` to `SettingsTab`)
- Modify: `src/modules/usage/store/usageStore.ts` (add `login`, `loginStart`, `loginFinish`, `logout`, `connected` actions)

**Interfaces:**
- Consumes: commands `usage_login`, `usage_login_start`, `usage_login_finish`, `usage_logout`, `usage_connected`; `openUrl` from `@tauri-apps/plugin-opener`.
- Produces: an Accounts settings tab with Connect/Disconnect per provider (Codex = one-click; Claude = open + paste-code + Finish).

- [ ] **Step 1: Add store actions.** In `src/modules/usage/store/usageStore.ts`, add to the store type + implementation (alongside existing actions):
```ts
  login: (provider: string) => Promise<void>;
  loginStart: (provider: string) => Promise<void>;
  loginFinish: (provider: string, code: string) => Promise<void>;
  logout: (provider: string) => Promise<void>;
```
Implementations:
```ts
  login: async (provider) => {
    await invoke("usage_login", { provider }).catch(() => {});
    await get().refresh(provider);
  },
  loginStart: async (provider) => {
    const url = await invoke<string>("usage_login_start", { provider });
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  loginFinish: async (provider, code) => {
    await invoke("usage_login_finish", { provider, code }).catch(() => {});
    await get().refresh(provider);
  },
  logout: async (provider) => {
    await invoke("usage_logout", { provider }).catch(() => {});
    set((s) => ({ providers: s.providers.filter((p) => p.provider !== provider) }));
  },
```

- [ ] **Step 2: Add `"accounts"` to the tab union.** In `src/modules/settings/openSettingsWindow.ts`, add `"accounts"` to the `SettingsTab` type.

- [ ] **Step 3: Build the section.** Create `src/settings/sections/AccountsSection.tsx`:
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUsageStore } from "@/modules/usage";
import { SectionHeader } from "../components/SectionHeader";

const PROVIDERS: { id: string; name: string; paste: boolean }[] = [
  { id: "codex", name: "Codex", paste: false },
  { id: "claude", name: "Claude", paste: true },
];

export function AccountsSection() {
  const { login, loginStart, loginFinish, logout } = useUsageStore();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [code, setCode] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refreshConnected = async () => {
    const entries = await Promise.all(
      PROVIDERS.map(async (p) => [p.id, await invoke<boolean>("usage_connected", { provider: p.id })] as const),
    );
    setConnected(Object.fromEntries(entries));
  };
  useEffect(() => {
    void refreshConnected();
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader title="Usage accounts" description="Sign in to show coding-agent usage in the status bar." />
      {PROVIDERS.map((p) => (
        <div key={p.id} className="rounded-lg border border-border/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">
              {connected[p.id] ? "Connected" : "Not connected"}
            </span>
          </div>
          {connected[p.id] ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await logout(p.id);
                await refreshConnected();
              }}
            >
              Disconnect
            </button>
          ) : p.paste ? (
            <div className="space-y-2">
              <button
                type="button"
                className="text-sm text-primary"
                disabled={busy === p.id}
                onClick={() => void loginStart(p.id)}
              >
                Open sign-in page
              </button>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-sm"
                  placeholder="Paste the code from the browser"
                  value={code[p.id] ?? ""}
                  onChange={(e) => setCode((c) => ({ ...c, [p.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="text-sm text-primary"
                  onClick={async () => {
                    setBusy(p.id);
                    await loginFinish(p.id, code[p.id] ?? "");
                    setBusy(null);
                    await refreshConnected();
                  }}
                >
                  Finish
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-sm text-primary"
              disabled={busy === p.id}
              onClick={async () => {
                setBusy(p.id);
                await login(p.id);
                setBusy(null);
                await refreshConnected();
              }}
            >
              {busy === p.id ? "Waiting for browser…" : "Connect"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab.** In `src/settings/SettingsApp.tsx`, import `AccountsSection` and add an "Accounts" entry to the tab list/switch, following the existing pattern for `GeneralSection`/`EditorSection` (match how tabs are registered there — same array/record the other sections use).

- [ ] **Step 5: Typecheck + build**
Run: `npx tsc --noEmit && npm run build`
Expected: passes (run `npx biome check --write` on changed files if needed).

- [ ] **Step 6: Commit**
```bash
git add src/settings/sections/AccountsSection.tsx src/settings/SettingsApp.tsx src/modules/settings/openSettingsWindow.ts src/modules/usage/store/usageStore.ts
git commit -m "feat(usage): Settings Accounts section (connect/disconnect per provider)"
```

---

### Task 8: Popover "Manage Accounts…" + startup wiring cleanup

**Files:**
- Modify: `src/modules/usage/UsagePopover.tsx` (Disconnect → `logout`; add "Manage Accounts…" → open Settings Accounts tab)
- Modify: `src/app/App.tsx` (startup: connect only providers that are logged in, not hardcoded both)

**Interfaces:**
- Consumes: `useUsageStore` (`logout`), `openSettingsWindow` (`@/modules/settings/openSettingsWindow`), command `usage_connected`.

- [ ] **Step 1: Popover actions.** In `src/modules/usage/UsagePopover.tsx`, change the Disconnect button to call the store's `logout(usage.provider)` (already added in Task 7) instead of the old `disconnect`, and add a "Manage Accounts…" button:
```tsx
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
// ...
<button type="button" className="mt-1 block text-muted-foreground hover:text-foreground"
        onClick={() => void openSettingsWindow("accounts")}>
  Manage Accounts…
</button>
```

- [ ] **Step 2: Startup refresh only for connected providers.** In `src/app/App.tsx`, replace the mount effect that did `for (const p of ["claude","codex"]) void connect(p)` with one that refreshes only connected providers:
```tsx
useEffect(() => {
  const { refresh, startAutoRefresh } = useUsageStore.getState();
  void (async () => {
    for (const p of ["claude", "codex"]) {
      if (await invoke<boolean>("usage_connected", { provider: p })) void refresh(p);
    }
  })();
  return startAutoRefresh();
}, []);
```
Add `import { invoke } from "@tauri-apps/api/core";` if not already present in App.tsx.

- [ ] **Step 3: Typecheck + build**
Run: `npx tsc --noEmit && npm run build`
Expected: passes.

- [ ] **Step 4: Commit**
```bash
git add src/modules/usage/UsagePopover.tsx src/app/App.tsx
git commit -m "feat(usage): popover Manage Accounts + connected-only startup refresh"
```

---

### Task 9: Manual end-to-end verification (checkpoint — human-run)

Not a code task; a required gate before merge (subagents can't drive a browser login).

- [ ] **Codex (loopback):** launch the app (`npm run tauri dev`), open Settings → Accounts → Codex → **Connect**. Browser opens auth.openai.com; approve. The tab shows "Login complete"; the chip shows live Codex usage matching `chatgpt.com/…/usage` (should match the dashboard). Restart the app → still connected (keychain).
- [ ] **Claude (paste):** Settings → Accounts → Claude → **Open sign-in page**; approve in browser; copy the shown code; paste into the field → **Finish**. Chip shows live Claude usage.
- [ ] **Disconnect:** from the popover or Settings → chip disappears; `usage_connected` returns false.
- [ ] **Expiry/refresh:** leave the app idle past the token's `expires_in`; the next poll refreshes silently (no "Sign in again") and persists new tokens (verify by restarting — still connected).
- [ ] If Codex's browser login fails to redirect to `localhost:1455`, confirm nothing else holds the port and that the redirect_uri matches exactly; if Claude's token exchange 403s, confirm the `claude-code/<ver>` User-Agent is being sent.

---

## Self-Review

**Spec coverage:**
- Pide-owned OAuth login, both providers → Tasks 1–4 (infra), 7 (UI). ✓
- SSO-only / remove CLI reuse → Tasks 5, 6 (delete `read_auth`/`parse_*_creds`). ✓
- Keychain storage, refresh+persist → Task 2 (store) + Tasks 5/6 (refresh→save). ✓
- Loopback (Codex) + paste (Claude) → Task 4 + Task 7. ✓
- PKCE S256, state/CSRF → Task 1 (pkce) + Task 4 (state verified in `wait_for_code`/`usage_login_finish`). ✓
- Provider UA for Claude token host → Task 3 (`client` sets UA), Task 6 (usage UA). ✓
- Usage endpoints/parsing unchanged → Tasks 5/6 keep `parse_*_usage`. ✓
- Settings Connect/Disconnect + email → Task 7. ✓
- Popover Manage/Disconnect → Task 8. ✓
- Manual browser-login verification → Task 9. ✓

**Placeholder scan:** no TBD/TODO; Task 4 Step 6 and Task 7 Step 4 reference "match the sibling pattern" for `lib.rs` handler registration and the Settings tab list — these are concrete (the exact sibling lines exist in those files); the implementer copies the established shape.

**Type consistency:** `Tokens{access,refresh,expires_at,account}`, `provider_config`, `store::{load,save,delete,is_expired}`, `token::{exchange_code,refresh,email_from_id_token}`, `ProviderConfig` fields, and command names (`usage_login`/`usage_login_start`/`usage_login_finish`/`usage_logout`/`usage_connected`) are consistent across Rust tasks and the TS store/UI.

## Known risks (carried from the spec)

- Claude's redirect is manual-code-paste and its token host is Cloudflare-UA-gated + rate-limited (mitigated by the CLI UA + refresh-only-on-expiry).
- Reusing the providers' public client_ids for our own PKCE grant assumes they permit it — the Task 9 Codex login is the first real proof; if the authorize call rejects our client/redirect, revisit before Claude.
