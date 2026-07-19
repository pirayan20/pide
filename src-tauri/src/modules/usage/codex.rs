use super::{status_from_windows, ProviderUsage, QuotaWindow, UsageStatus};
use serde_json::Value;
use std::io::BufRead;
use std::path::{Path, PathBuf};

// Codex has no usage endpoint (the Task 1 spike confirmed none). Instead it
// records a `rate_limits` snapshot on each turn into its session rollout files
// under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. We read the freshest
// snapshot from disk — no token, no network. Only the rate_limits object is
// extracted; conversation content in those files is never read out.

fn window_label(window_minutes: i64) -> String {
    match window_minutes {
        0 => "Session".into(),
        10080 => "Weekly".into(),
        m if m % 1440 == 0 => format!("{}d", m / 1440),
        m if m % 60 == 0 => format!("{}h", m / 60),
        m => format!("{}m", m),
    }
}

fn window_from(node: &Value) -> Option<QuotaWindow> {
    let used = node.get("used_percent").and_then(Value::as_f64)?;
    let mins = node.get("window_minutes").and_then(Value::as_i64).unwrap_or(0);
    // resets_at is an epoch in seconds; QuotaWindow.resets_at is unix ms.
    let resets_at = node.get("resets_at").and_then(Value::as_i64).map(|s| s * 1000);
    Some(QuotaWindow { label: window_label(mins), used_pct: used as f32, resets_at })
}

pub fn parse_rate_limits(rl: &Value) -> Vec<QuotaWindow> {
    ["primary", "secondary"]
        .iter()
        .filter_map(|k| rl.get(*k))
        .filter_map(window_from)
        .collect()
}

// A rollout line wraps the snapshot as { type, payload: { .. rate_limits .. } };
// recurse to find the (non-null) rate_limits object regardless of exact nesting.
fn find_rate_limits(v: &Value) -> Option<&Value> {
    match v {
        Value::Object(m) => {
            if let Some(rl) = m.get("rate_limits") {
                if !rl.is_null() {
                    return Some(rl);
                }
            }
            m.values().find_map(find_rate_limits)
        }
        Value::Array(a) => a.iter().find_map(find_rate_limits),
        _ => None,
    }
}

fn max_subdir(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .max_by(|a, b| a.file_name().cmp(&b.file_name()))
}

// ponytail: descend sessions/YYYY/MM/DD by greatest-named entry (zero-padded
// dates sort chronologically), then newest .jsonl by mtime in that day — the
// freshest snapshot for an active session, without stat-ing every file.
fn newest_rollout() -> Option<PathBuf> {
    let mut dir = dirs::home_dir()?.join(".codex/sessions");
    for _ in 0..3 {
        dir = max_subdir(&dir)?;
    }
    std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}

fn latest_rate_limits() -> Option<Value> {
    let file = std::fs::File::open(newest_rollout()?).ok()?;
    let mut last = None;
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        if !line.contains("rate_limits") {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if let Some(rl) = find_rate_limits(&v) {
                last = Some(rl.clone());
            }
        }
    }
    last
}

fn codex_logged_in() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".codex/auth.json").exists())
        .unwrap_or(false)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn usage(status: UsageStatus, windows: Vec<QuotaWindow>) -> ProviderUsage {
    ProviderUsage { provider: "codex".into(), status, account: None, plan: None, windows, fetched_at: now_ms() }
}

pub fn fetch_codex() -> ProviderUsage {
    if !codex_logged_in() {
        return usage(UsageStatus::SignedOut, vec![]);
    }
    match latest_rate_limits() {
        Some(rl) => {
            let windows = parse_rate_limits(&rl);
            if windows.is_empty() {
                usage(UsageStatus::Unavailable, vec![])
            } else {
                usage(status_from_windows(&windows), windows)
            }
        }
        // Logged in but no snapshot yet (never ran a turn) — nothing to show.
        None => usage(UsageStatus::Unavailable, vec![]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_label_maps_common_windows() {
        assert_eq!(window_label(300), "5h");
        assert_eq!(window_label(10080), "Weekly");
        assert_eq!(window_label(60), "1h");
        assert_eq!(window_label(2880), "2d");
    }

    #[test]
    fn parses_rate_limits_primary_and_secondary() {
        let rl: Value =
            serde_json::from_str(include_str!("fixtures/codex_rate_limits.json")).unwrap();
        let windows = parse_rate_limits(&rl);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].label, "5h");
        assert_eq!(windows[0].used_pct, 26.0);
        assert_eq!(windows[0].resets_at, Some(1_784_709_047 * 1000));
        assert_eq!(windows[1].label, "Weekly");
        assert_eq!(windows[1].used_pct, 4.0);
    }

    #[test]
    fn null_secondary_is_skipped() {
        let rl: Value = serde_json::from_str(
            r#"{"primary":{"used_percent":50.0,"window_minutes":300,"resets_at":1},"secondary":null}"#,
        )
        .unwrap();
        let windows = parse_rate_limits(&rl);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "5h");
    }

    #[test]
    fn finds_rate_limits_nested_in_payload() {
        let line: Value = serde_json::from_str(
            r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":9.0,"window_minutes":300,"resets_at":2}}}}"#,
        )
        .unwrap();
        let rl = find_rate_limits(&line).unwrap();
        assert_eq!(parse_rate_limits(rl)[0].used_pct, 9.0);
    }

    #[test]
    fn ignores_null_rate_limits_line() {
        let line: Value =
            serde_json::from_str(r#"{"type":"event_msg","payload":{"rate_limits":null}}"#).unwrap();
        assert!(find_rate_limits(&line).is_none());
    }
}
