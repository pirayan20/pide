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
