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
