use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;
use std::time::Duration;

// Orca's approach: reuse the Claude Code CLI credentials, own the refresh, and
// persist the rotated (single-use) refresh token back to the CLI's store so we
// never strand it. Creds live in the macOS Keychain item "Claude Code-credentials"
// (account = $USER) or ~/.claude/.credentials.json, as the `claudeAiOauth` blob.
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const UA: &str = "claude-code/2.1.207";
const EXPIRY_SKEW_MS: i64 = 5 * 60 * 1000;

// ---- credential store I/O (macOS Keychain / file) ----

#[cfg(target_os = "macos")]
fn keychain_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "user".into())
}

fn read_credentials() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-a", &keychain_user(), "-w"])
            .output()
            .ok()?;
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        let path = dirs::home_dir()?.join(".claude/.credentials.json");
        std::fs::read_to_string(path).ok()
    }
}

fn write_credentials(contents: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("security")
            .args(["add-generic-password", "-U", "-s", "Claude Code-credentials", "-a", &keychain_user(), "-w", contents])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        match dirs::home_dir() {
            Some(h) => std::fs::write(h.join(".claude/.credentials.json"), contents).is_ok(),
            None => false,
        }
    }
}

// ---- pure credential logic (ported from orca claude-accounts/oauth-refresh.ts) ----

fn oauth_blob(creds: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(creds).ok()?;
    let o = v.get("claudeAiOauth")?;
    o.is_object().then(|| o.clone())
}

fn read_access(creds: &str) -> Option<String> {
    let t = oauth_blob(creds)?.get("accessToken")?.as_str()?.trim().to_string();
    (!t.is_empty()).then_some(t)
}

fn read_refresh(creds: &str) -> Option<String> {
    let t = oauth_blob(creds)?.get("refreshToken")?.as_str()?.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// Access token expired or within the 5-minute refresh buffer. A missing/
/// non-numeric expiresAt is treated as "needs refresh".
pub fn is_expiring(creds: &str, now_ms: i64) -> bool {
    let Some(o) = oauth_blob(creds) else { return false };
    match o.get("expiresAt").and_then(Value::as_i64) {
        Some(exp) => now_ms + EXPIRY_SKEW_MS >= exp,
        None => true,
    }
}

/// Merge a token-endpoint response into the creds JSON, preserving every field
/// the caller had (incl. the refresh token when the server doesn't rotate it).
pub fn apply_refreshed(creds: &str, resp: &Value, now_ms: i64) -> Option<String> {
    let mut parsed: Value = serde_json::from_str(creds).ok()?;
    let access = resp.get("access_token")?.as_str()?.trim().to_string();
    if access.is_empty() {
        return None;
    }
    let mut o = parsed
        .get("claudeAiOauth")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    o.insert("accessToken".into(), Value::String(access));
    if let Some(ei) = resp.get("expires_in").and_then(Value::as_i64) {
        o.insert("expiresAt".into(), Value::from(now_ms + ei * 1000));
    }
    if let Some(rt) = resp.get("refresh_token").and_then(Value::as_str) {
        if !rt.trim().is_empty() {
            o.insert("refreshToken".into(), Value::String(rt.to_string()));
        }
    }
    if let Some(scope) = resp.get("scope").and_then(Value::as_str) {
        if !scope.trim().is_empty() {
            o.insert("scopes".into(), Value::from(scope.split(' ').collect::<Vec<_>>()));
        }
    }
    parsed.as_object_mut()?.insert("claudeAiOauth".into(), Value::Object(o));
    serde_json::to_string(&parsed).ok()
}

// ---- refresh (form-urlencoded, like the CLI) ----

fn refresh_credentials(creds: &str) -> Option<String> {
    let refresh = read_refresh(creds)?;
    let c = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(UA)
        .build()
        .ok()?;
    let resp = c
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    apply_refreshed(creds, &resp.json::<Value>().ok()?, now_ms())
}

// ---- usage parse (unchanged, tested) ----

fn window(body: &Value, key: &str, label: &str) -> Option<QuotaWindow> {
    let node = body.get(key)?;
    Some(QuotaWindow {
        label: label.to_string(),
        used_pct: node.get("utilization")?.as_f64()? as f32,
        resets_at: node.get("resets_at").and_then(Value::as_i64).map(|s| s * 1000),
    })
}

pub fn parse_claude_usage(body: &Value) -> (Vec<QuotaWindow>, Option<String>, Option<String>) {
    let windows = [("five_hour", "5h"), ("seven_day", "Weekly"), ("seven_day_opus", "Fable")]
        .iter()
        .filter_map(|(k, l)| window(body, k, l))
        .collect();
    let account = body.get("account").and_then(|a| a.get("email")).and_then(Value::as_str).map(str::to_string);
    let plan = body.get("account").and_then(|a| a.get("plan")).and_then(Value::as_str).map(str::to_string);
    (windows, account, plan)
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
    let Some(creds) = read_credentials() else {
        return usage(UsageStatus::SignedOut, vec![], None, None);
    };
    // Refresh proactively when expiring, and persist the rotated token back to
    // the CLI store so we don't strand a single-use refresh token.
    let creds = if is_expiring(&creds, now_ms()) {
        match refresh_credentials(&creds) {
            Some(updated) => {
                write_credentials(&updated);
                updated
            }
            None => creds, // transient/denied: try the existing token, may 401
        }
    } else {
        creds
    };
    let Some(access) = read_access(&creds) else {
        return usage(UsageStatus::AuthExpired, vec![], None, None);
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(_) => return usage(UsageStatus::Unavailable, vec![], None, None),
    };
    match client.get(USAGE_URL).bearer_auth(&access).header("anthropic-beta", OAUTH_BETA).send() {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
            usage(UsageStatus::AuthExpired, vec![], None, None)
        }
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_claude_usage(&body);
                if windows.is_empty() {
                    usage(UsageStatus::Unavailable, windows, account, plan)
                } else {
                    usage(status_from_windows(&windows), windows, account, plan)
                }
            }
            Err(_) => usage(UsageStatus::Unavailable, vec![], None, None),
        },
        _ => usage(UsageStatus::Unavailable, vec![], None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_three_windows_account_and_plan() {
        let body: Value = serde_json::from_str(include_str!("fixtures/claude_usage.json")).unwrap();
        let (windows, account, plan) = parse_claude_usage(&body);
        let labels: Vec<_> = windows.iter().map(|w| w.label.as_str()).collect();
        assert_eq!(labels, vec!["5h", "Weekly", "Fable"]);
        assert_eq!(windows[0].used_pct, 38.0);
        assert_eq!(account.as_deref(), Some("user@example.com"));
        assert_eq!(plan.as_deref(), Some("max"));
    }

    #[test]
    fn reads_access_and_refresh_from_blob() {
        let creds = r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":100}}"#;
        assert_eq!(read_access(creds).as_deref(), Some("a"));
        assert_eq!(read_refresh(creds).as_deref(), Some("r"));
    }

    #[test]
    fn is_expiring_uses_5min_skew_and_missing_expiry() {
        let base = r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":10000000}}"#;
        assert!(!is_expiring(base, 10000000 - 6 * 60 * 1000)); // >5min before -> fresh
        assert!(is_expiring(base, 10000000 - 60 * 1000)); // within 5min -> refresh
        let no_exp = r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r"}}"#;
        assert!(is_expiring(no_exp, 0)); // missing expiresAt -> refresh
        assert!(!is_expiring("{}", 0)); // no oauth blob -> not expiring (nothing to do)
    }

    #[test]
    fn apply_refreshed_rotates_and_preserves() {
        let creds = r#"{"other":1,"claudeAiOauth":{"accessToken":"old","refreshToken":"oldR","expiresAt":1}}"#;
        // server rotates the refresh token
        let resp = json!({"access_token":"newA","expires_in":3600,"refresh_token":"newR"});
        let out = apply_refreshed(creds, &resp, 1_000_000).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["claudeAiOauth"]["accessToken"], "newA");
        assert_eq!(v["claudeAiOauth"]["refreshToken"], "newR");
        assert_eq!(v["claudeAiOauth"]["expiresAt"], 1_000_000 + 3600 * 1000);
        assert_eq!(v["other"], 1); // unrelated fields preserved
        // when server omits refresh_token, keep the prior one
        let resp2 = json!({"access_token":"newA2","expires_in":3600});
        let out2 = apply_refreshed(&out, &resp2, 2_000_000).unwrap();
        let v2: Value = serde_json::from_str(&out2).unwrap();
        assert_eq!(v2["claudeAiOauth"]["refreshToken"], "newR");
    }
}
