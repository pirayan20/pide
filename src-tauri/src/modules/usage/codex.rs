use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;
use std::time::Duration;

// Orca's approach: reuse the Codex CLI credentials in ~/.codex/auth.json (which
// the CLI keeps fresh), read live usage from the backend, and on a 401 refresh
// the token and persist the rotated value back to auth.json so it isn't stranded.
const USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

fn auth_path() -> Option<std::path::PathBuf> {
    if let Ok(home) = std::env::var("CODEX_HOME") {
        return Some(std::path::PathBuf::from(home).join("auth.json"));
    }
    Some(dirs::home_dir()?.join(".codex/auth.json"))
}

fn read_auth_file() -> Option<String> {
    std::fs::read_to_string(auth_path()?).ok()
}

fn write_auth_file(contents: &str) -> bool {
    match auth_path() {
        Some(p) => std::fs::write(p, contents).is_ok(),
        None => false,
    }
}

fn field<'a>(auth: &'a Value, key: &str) -> Option<&'a str> {
    auth.get("tokens")?.get(key)?.as_str()
}

/// Merge a token-endpoint response back into the auth.json structure, updating
/// the tokens sub-object and preserving everything else (OPENAI_API_KEY, etc.).
pub fn apply_codex_refresh(auth_json: &str, resp: &Value) -> Option<String> {
    let mut parsed: Value = serde_json::from_str(auth_json).ok()?;
    let access = resp.get("access_token")?.as_str()?.to_string();
    let tokens = parsed.get_mut("tokens")?.as_object_mut()?;
    tokens.insert("access_token".into(), Value::String(access));
    for k in ["refresh_token", "id_token"] {
        if let Some(v) = resp.get(k).and_then(Value::as_str) {
            tokens.insert(k.into(), Value::String(v.to_string()));
        }
    }
    serde_json::to_string(&parsed).ok()
}

fn refresh_and_persist(auth_json: &str) -> Option<String> {
    let refresh = {
        let v: Value = serde_json::from_str(auth_json).ok()?;
        field(&v, "refresh_token")?.to_string()
    };
    let c = reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build().ok()?;
    let resp = c
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "scope": "openid profile email",
        }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let updated = apply_codex_refresh(auth_json, &resp.json::<Value>().ok()?)?;
    write_auth_file(&updated);
    let v: Value = serde_json::from_str(&updated).ok()?;
    field(&v, "access_token").map(str::to_string)
}

// ---- usage parse (unchanged, tested) ----

fn label_for(window_seconds: i64) -> String {
    match window_seconds {
        604800 => "Weekly".into(),
        s if s % 86400 == 0 && s >= 86400 => format!("{}d", s / 86400),
        s if s % 3600 == 0 && s >= 3600 => format!("{}h", s / 3600),
        s if s > 0 => format!("{}m", s / 60),
        _ => "Session".into(),
    }
}

fn short_name(name: &str) -> String {
    name.rsplit('-').next().unwrap_or(name).to_string()
}

fn window_from(node: &Value, label: Option<String>) -> Option<QuotaWindow> {
    let used = node.get("used_percent").and_then(Value::as_f64)?;
    let secs = node.get("limit_window_seconds").and_then(Value::as_i64).unwrap_or(0);
    let resets_at = node.get("reset_at").and_then(Value::as_i64).map(|s| s * 1000);
    Some(QuotaWindow { label: label.unwrap_or_else(|| label_for(secs)), used_pct: used as f32, resets_at })
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
            extra.get("rate_limit").and_then(|r| r.get("primary_window")).and_then(|n| window_from(n, label)),
        );
    }
    let account = body.get("email").and_then(Value::as_str).map(str::to_string);
    let plan = body.get("plan_type").and_then(Value::as_str).map(str::to_string);
    (windows, account, plan)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn usage(status: UsageStatus, windows: Vec<QuotaWindow>, account: Option<String>, plan: Option<String>) -> ProviderUsage {
    ProviderUsage { provider: "codex".into(), status, account, plan, windows, fetched_at: now_ms() }
}

enum Outcome {
    Ok(ProviderUsage),
    Unauthorized,
    Failed,
}

fn fetch_usage(access: &str, account_id: Option<&str>) -> Outcome {
    let Some(c) =
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).user_agent("codex_cli_rs").build().ok()
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
    let Some(auth_json) = read_auth_file() else {
        return usage(UsageStatus::SignedOut, vec![], None, None);
    };
    let parsed: Value = match serde_json::from_str(&auth_json) {
        Ok(v) => v,
        Err(_) => return usage(UsageStatus::Unavailable, vec![], None, None),
    };
    let account_id = field(&parsed, "account_id").map(str::to_string);
    let Some(access) = field(&parsed, "access_token").map(str::to_string) else {
        return usage(UsageStatus::AuthExpired, vec![], None, None);
    };
    // Try the stored token (CLI keeps it fresh while in use); on 401 refresh +
    // persist back to auth.json and retry once.
    match fetch_usage(&access, account_id.as_deref()) {
        Outcome::Ok(pu) => pu,
        Outcome::Failed => usage(UsageStatus::Unavailable, vec![], None, None),
        Outcome::Unauthorized => match refresh_and_persist(&auth_json) {
            Some(new_access) => match fetch_usage(&new_access, account_id.as_deref()) {
                Outcome::Ok(pu) => pu,
                Outcome::Unauthorized => usage(UsageStatus::AuthExpired, vec![], None, None),
                Outcome::Failed => usage(UsageStatus::Unavailable, vec![], None, None),
            },
            None => usage(UsageStatus::AuthExpired, vec![], None, None),
        },
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
        let body: Value = serde_json::from_str(include_str!("fixtures/codex_usage.json")).unwrap();
        let (windows, account, plan) = parse_codex_usage(&body);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].label, "Weekly");
        assert_eq!(windows[0].used_pct, 26.0);
        assert_eq!(windows[0].resets_at, Some(1_784_953_410 * 1000));
        assert_eq!(windows[1].label, "Spark");
        assert_eq!(account.as_deref(), Some("user@example.com"));
        assert_eq!(plan.as_deref(), Some("prolite"));
    }

    #[test]
    fn apply_codex_refresh_updates_tokens_preserves_rest() {
        let auth = r#"{"OPENAI_API_KEY":"k","tokens":{"access_token":"old","refresh_token":"oldR","account_id":"acc"}}"#;
        let resp = json!({"access_token":"newA","refresh_token":"newR","id_token":"idt"});
        let out = apply_codex_refresh(auth, &resp).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["tokens"]["access_token"], "newA");
        assert_eq!(v["tokens"]["refresh_token"], "newR");
        assert_eq!(v["tokens"]["id_token"], "idt");
        assert_eq!(v["tokens"]["account_id"], "acc");
        assert_eq!(v["OPENAI_API_KEY"], "k");
    }
}
