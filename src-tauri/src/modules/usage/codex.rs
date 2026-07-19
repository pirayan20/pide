use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use crate::modules::oauth;
use serde_json::Value;
use std::time::Duration;

// Codex has no unauthenticated usage source. Its stored access token expires,
// so — like the CLI does on startup — we exchange the (reusable) refresh token
// for a fresh access token in memory, then read live usage. Confirmed shape:
//   GET https://chatgpt.com/backend-api/codex/usage
//   -> { email, plan_type, rate_limit: { primary_window, secondary_window },
//        additional_rate_limits: [ { limit_name, rate_limit: { primary_window } } ] }
// where *_window = { used_percent, limit_window_seconds, reset_at (epoch secs) }.
const USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";

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

enum Outcome {
    Ok(ProviderUsage),
    Unauthorized,
    Failed,
}

fn fetch_usage(access: &str, account_id: &Option<String>) -> Outcome {
    let Some(c) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("codex_cli_rs")
        .build()
        .ok()
    else {
        return Outcome::Failed;
    };
    let mut req = c.get(USAGE_URL).bearer_auth(access).header("originator", "codex_cli_rs");
    if let Some(id) = account_id {
        req = req.header("chatgpt-account-id", id);
    }
    match req.send() {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => Outcome::Unauthorized,
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_codex_usage(&body);
                if windows.is_empty() {
                    Outcome::Ok(usage(UsageStatus::Unavailable, vec![], account, plan))
                } else {
                    Outcome::Ok(usage(status_from_windows(&windows), windows, account, plan))
                }
            }
            Err(_) => Outcome::Failed,
        },
        _ => Outcome::Failed,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
