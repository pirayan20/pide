use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use crate::modules::oauth;
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage"; // confirmed in Task 1
const OAUTH_BETA: &str = "oauth-2025-04-20"; // confirmed in Task 1

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

fn access_token() -> Option<String> {
    let mut t = oauth::store::load("claude")?;
    if oauth::store::is_expired(&t, now_ms()) {
        let cfg = oauth::provider_config("claude")?;
        t = oauth::token::refresh(&cfg, &t.refresh)?;
        oauth::store::save("claude", &t);
    }
    Some(t.access)
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
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(body) => {
                let (windows, account, plan) = parse_claude_usage(&body);
                if windows.is_empty() {
                    // 200 with no windows the parser recognizes: degrade to
                    // Unavailable instead of rendering a blank chip.
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
