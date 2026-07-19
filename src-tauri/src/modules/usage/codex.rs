use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::{json, Value};
use std::time::Duration;

// Codex has no unauthenticated usage source. Its stored access token expires,
// so — like the CLI does on startup — we exchange the (reusable) refresh token
// for a fresh access token in memory, then read live usage. Confirmed shape:
//   GET https://chatgpt.com/backend-api/codex/usage
//   -> { email, plan_type, rate_limit: { primary_window, secondary_window },
//        additional_rate_limits: [ { limit_name, rate_limit: { primary_window } } ] }
// where *_window = { used_percent, limit_window_seconds, reset_at (epoch secs) }.
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";

struct CodexAuth {
    refresh_token: String,
    account_id: Option<String>,
}

fn parse_codex_auth(json_str: &str) -> Option<CodexAuth> {
    let v: Value = serde_json::from_str(json_str).ok()?;
    let tokens = v.get("tokens")?;
    Some(CodexAuth {
        refresh_token: tokens.get("refresh_token")?.as_str()?.to_string(),
        account_id: tokens.get("account_id").and_then(Value::as_str).map(str::to_string),
    })
}

fn read_auth() -> Option<CodexAuth> {
    let path = dirs::home_dir()?.join(".codex/auth.json");
    parse_codex_auth(&std::fs::read_to_string(path).ok()?)
}

fn label_for(window_seconds: i64) -> String {
    match window_seconds {
        604800 => "Weekly".into(),
        s if s % 86400 == 0 && s >= 86400 => format!("{}d", s / 86400),
        s if s % 3600 == 0 && s >= 3600 => format!("{}h", s / 3600),
        s if s > 0 => format!("{}m", s / 60),
        _ => "Session".into(),
    }
}

// "GPT-5.3-Codex-Spark" -> "Spark" (mirrors how the compact chip labels
// model-specific windows, e.g. Claude's "Fable").
fn short_name(name: &str) -> String {
    name.rsplit('-').next().unwrap_or(name).to_string()
}

// A *_window node -> QuotaWindow. `label` overrides the window-duration label
// (used for the named additional limits).
fn window_from(node: &Value, label: Option<String>) -> Option<QuotaWindow> {
    let used = node.get("used_percent").and_then(Value::as_f64)?;
    let secs = node.get("limit_window_seconds").and_then(Value::as_i64).unwrap_or(0);
    let resets_at = node.get("reset_at").and_then(Value::as_i64).map(|s| s * 1000);
    Some(QuotaWindow {
        label: label.unwrap_or_else(|| label_for(secs)),
        used_pct: used as f32,
        resets_at,
    })
}

fn parse_codex_usage(body: &Value) -> (Vec<QuotaWindow>, Option<String>, Option<String>) {
    let mut windows = Vec::new();
    if let Some(rl) = body.get("rate_limit") {
        windows.extend(rl.get("primary_window").and_then(|n| window_from(n, None)));
        windows.extend(rl.get("secondary_window").and_then(|n| window_from(n, None)));
    }
    for extra in body.get("additional_rate_limits").and_then(Value::as_array).into_iter().flatten() {
        let label = extra.get("limit_name").and_then(Value::as_str).map(short_name);
        windows.extend(
            extra
                .get("rate_limit")
                .and_then(|r| r.get("primary_window"))
                .and_then(|n| window_from(n, label)),
        );
    }
    let account = body.get("email").and_then(Value::as_str).map(str::to_string);
    let plan = body.get("plan_type").and_then(Value::as_str).map(str::to_string);
    (windows, account, plan)
}

// ponytail: refresh on every fetch (one extra request per poll). Cache by the
// token's expires_in if the poll cadence ever makes this matter.
fn refresh_access_token(c: &reqwest::blocking::Client, refresh_token: &str) -> Option<String> {
    let resp = c
        .post(TOKEN_URL)
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": "openid profile email",
        }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>()
        .ok()?
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn usage(
    status: UsageStatus,
    windows: Vec<QuotaWindow>,
    account: Option<String>,
    plan: Option<String>,
) -> ProviderUsage {
    ProviderUsage { provider: "codex".into(), status, account, plan, windows, fetched_at: now_ms() }
}

pub fn fetch_codex() -> ProviderUsage {
    let Some(auth) = read_auth() else {
        return usage(UsageStatus::SignedOut, vec![], None, None);
    };
    let Some(client) =
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build().ok()
    else {
        return usage(UsageStatus::Unavailable, vec![], None, None);
    };
    // Access token in auth.json is usually expired; refresh it (read-only).
    let Some(access) = refresh_access_token(&client, &auth.refresh_token) else {
        return usage(UsageStatus::AuthExpired, vec![], None, None);
    };
    let mut req = client
        .get(USAGE_URL)
        .bearer_auth(&access)
        .header("User-Agent", "codex_cli_rs")
        .header("originator", "codex_cli_rs");
    if let Some(id) = &auth.account_id {
        req = req.header("chatgpt-account-id", id);
    }
    match req.send() {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
            usage(UsageStatus::AuthExpired, vec![], None, None)
        }
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_codex_usage(&body);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_auth_extracts_refresh_and_account() {
        let a = parse_codex_auth(r#"{"tokens":{"refresh_token":"rt-1","account_id":"acc-1"}}"#).unwrap();
        assert_eq!(a.refresh_token, "rt-1");
        assert_eq!(a.account_id.as_deref(), Some("acc-1"));
    }

    #[test]
    fn parse_auth_missing_refresh_is_none() {
        assert!(parse_codex_auth(r#"{"tokens":{"access_token":"x"}}"#).is_none());
    }

    #[test]
    fn label_for_common_windows() {
        assert_eq!(label_for(604800), "Weekly");
        assert_eq!(label_for(18000), "5h");
        assert_eq!(label_for(3600), "1h");
        assert_eq!(label_for(86400), "1d");
    }

    #[test]
    fn short_name_takes_last_segment() {
        assert_eq!(short_name("GPT-5.3-Codex-Spark"), "Spark");
        assert_eq!(short_name("Weekly"), "Weekly");
    }

    #[test]
    fn parses_usage_windows_account_plan() {
        let body: Value =
            serde_json::from_str(include_str!("fixtures/codex_usage.json")).unwrap();
        let (windows, account, plan) = parse_codex_usage(&body);
        // primary weekly + the named additional limit; null secondary skipped.
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].label, "Weekly");
        assert_eq!(windows[0].used_pct, 26.0);
        assert_eq!(windows[0].resets_at, Some(1_784_953_410 * 1000));
        assert_eq!(windows[1].label, "Spark");
        assert_eq!(windows[1].used_pct, 0.0);
        assert_eq!(account.as_deref(), Some("user@example.com"));
        assert_eq!(plan.as_deref(), Some("prolite"));
    }

    #[test]
    fn empty_when_no_rate_limit() {
        let (w, _, _) = parse_codex_usage(&json!({}));
        assert!(w.is_empty());
    }
}
