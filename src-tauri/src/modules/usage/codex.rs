use super::{ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;

// No Codex usage endpoint is confirmed (the Task 1 spike found none). Per
// spec, an unconfirmed endpoint must not be called with a real token, so
// fetch_codex() below short-circuits to Unavailable instead of guessing.
// Kept here, unused, for when an endpoint is confirmed.
#[allow(dead_code)]
const USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";

// Fields are unread outside tests now that fetch_codex() short-circuits
// before making a request; kept for when a usage endpoint is confirmed.
#[allow(dead_code)]
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

// Unused outside tests now that fetch_codex() short-circuits before parsing
// a response; kept for when a usage endpoint is confirmed.
#[allow(dead_code)]
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
    let Some(_creds) = read_creds() else {
        return usage(UsageStatus::SignedOut, vec![], None);
    };
    // No confirmed usage endpoint to call — ship Unavailable rather than
    // hitting a guessed URL with the user's real token.
    usage(UsageStatus::Unavailable, vec![], None)
}

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
