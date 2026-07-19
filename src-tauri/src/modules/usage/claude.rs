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
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return usage(UsageStatus::Unavailable, vec![], None, None),
    };
    let resp = client
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
