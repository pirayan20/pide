use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

pub mod loopback;
pub mod store;
pub mod token;

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

/// Anthropic's paste page yields "code#state"; loopback yields a bare code.
pub fn split_pasted_code(pasted: &str) -> (String, Option<String>) {
    match pasted.trim().split_once('#') {
        Some((c, s)) => (c.to_string(), Some(s.to_string())),
        None => (pasted.trim().to_string(), None),
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

/// Loopback login (Codex): bind the callback port, open browser, wait for
/// the callback, exchange, save. Binding first fails fast if the port is
/// busy instead of stranding the user mid-auth.
#[tauri::command]
pub async fn usage_login(app: tauri::AppHandle, provider: String) -> Result<Option<String>, String> {
    let cfg = provider_config(&provider).ok_or("unknown provider")?;
    let port = cfg.loopback_port.ok_or("provider is not loopback; use usage_login_start")?;
    let listener = loopback::bind(port).ok_or("port 1455 is busy")?;
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
        let code = loopback::wait_on(&listener, &state, Duration::from_secs(120))?;
        token::exchange_code(&cfg, &code, &verifier, None)
    })
    .await
    .map_err(|e| e.to_string())?;
    let tokens = tokens.ok_or("login did not complete")?;
    if !store::save(&provider, &tokens) {
        return Err("failed to store tokens".into());
    }
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
/// Anthropic's paste page yields "code#state"; verify state when present.
#[tauri::command]
pub fn usage_login_finish(
    provider: String,
    code: String,
    state: tauri::State<OauthState>,
) -> Result<Option<String>, String> {
    let cfg = provider_config(&provider).ok_or("unknown provider")?;
    let pending = state.0.lock().unwrap().remove(&provider).ok_or("no pending login")?;
    let (code_part, state_opt) = split_pasted_code(&code);
    if let Some(s) = &state_opt {
        if s != &pending.state {
            return Err("state mismatch".into());
        }
    }
    let tokens = token::exchange_code(&cfg, &code_part, &pending.verifier, state_opt.as_deref())
        .ok_or("code exchange failed")?;
    if !store::save(&provider, &tokens) {
        return Err("failed to store tokens".into());
    }
    Ok(tokens.account)
}

#[tauri::command]
pub fn usage_logout(provider: String, usage_state: tauri::State<crate::modules::usage::UsageState>) {
    store::delete(&provider);
    usage_state.0.lock().unwrap().remove(&provider);
}

#[tauri::command]
pub fn usage_connected(provider: String) -> bool {
    store::load(&provider).is_some()
}

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

    #[test]
    fn split_pasted_code_splits_on_hash() {
        assert_eq!(split_pasted_code("abc#xyz"), ("abc".to_string(), Some("xyz".to_string())));
    }

    #[test]
    fn split_pasted_code_bare_code_has_no_state() {
        assert_eq!(split_pasted_code("abc"), ("abc".to_string(), None));
    }
}
