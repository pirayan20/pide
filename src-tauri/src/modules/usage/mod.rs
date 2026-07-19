mod claude;
pub use claude::fetch_claude;

mod codex;
pub use codex::fetch_codex;

pub const LIMITED_THRESHOLD: f32 = 95.0;

#[derive(Clone, serde::Serialize)]
pub struct QuotaWindow {
    pub label: String,
    pub used_pct: f32,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatus {
    SignedOut,
    Loading,
    Ok,
    Limited,
    Stale,
    Unavailable,
    AuthExpired,
}

#[derive(Clone, serde::Serialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub status: UsageStatus,
    pub account: Option<String>,
    pub plan: Option<String>,
    pub windows: Vec<QuotaWindow>,
    pub fetched_at: i64,
}

pub fn most_constrained(windows: &[QuotaWindow]) -> Option<&QuotaWindow> {
    windows
        .iter()
        .max_by(|a, b| a.used_pct.partial_cmp(&b.used_pct).unwrap_or(std::cmp::Ordering::Equal))
}

pub fn status_from_windows(windows: &[QuotaWindow]) -> UsageStatus {
    match most_constrained(windows) {
        Some(w) if w.used_pct >= LIMITED_THRESHOLD => UsageStatus::Limited,
        _ => UsageStatus::Ok,
    }
}

pub fn next_backoff_ms(failures: u32) -> i64 {
    let base: i64 = 60_000;
    let factor = 1i64 << failures.min(5);
    (base.saturating_mul(factor)).min(30 * 60_000)
}

use std::collections::HashMap;
use std::sync::Mutex;

pub struct Cached {
    pub usage: ProviderUsage,
    pub connected: bool,
    pub failures: u32,
    pub next_allowed_at: i64,
}

#[derive(Default)]
pub struct UsageState(pub Mutex<HashMap<String, Cached>>);

pub fn fetch_allowed(now_ms: i64, next_allowed_at: i64) -> bool {
    now_ms >= next_allowed_at
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fetch_provider(provider: &str) -> ProviderUsage {
    match provider {
        "claude" => fetch_claude(),
        "codex" => fetch_codex(),
        _ => ProviderUsage {
            provider: provider.to_string(),
            status: UsageStatus::Unavailable,
            account: None,
            plan: None,
            windows: vec![],
            fetched_at: now_ms(),
        },
    }
}

fn do_refresh(state: &UsageState, provider: &str) -> ProviderUsage {
    let now = now_ms();
    {
        // Respect backoff: return cached snapshot without hitting the network.
        let map = state.0.lock().unwrap();
        if let Some(c) = map.get(provider) {
            if !fetch_allowed(now, c.next_allowed_at) {
                return c.usage.clone();
            }
        }
    }
    let usage = fetch_provider(provider);
    let failed = matches!(usage.status, UsageStatus::Unavailable);
    let mut map = state.0.lock().unwrap();
    let entry = map.entry(provider.to_string()).or_insert(Cached {
        usage: usage.clone(),
        connected: true,
        failures: 0,
        next_allowed_at: 0,
    });
    entry.connected = true;
    if failed {
        entry.failures = entry.failures.saturating_add(1);
        entry.next_allowed_at = now + next_backoff_ms(entry.failures);
    } else {
        entry.failures = 0;
        entry.next_allowed_at = 0;
    }
    entry.usage = usage.clone();
    usage
}

#[tauri::command]
pub fn usage_snapshot(state: tauri::State<UsageState>) -> Vec<ProviderUsage> {
    state
        .0
        .lock()
        .unwrap()
        .values()
        .filter(|c| c.connected)
        .map(|c| c.usage.clone())
        .collect()
}

#[tauri::command]
pub fn usage_refresh(provider: String, state: tauri::State<UsageState>) -> ProviderUsage {
    do_refresh(&state, &provider)
}

#[tauri::command]
pub fn usage_connect(provider: String, state: tauri::State<UsageState>) -> ProviderUsage {
    {
        let mut map = state.0.lock().unwrap();
        if let Some(c) = map.get_mut(&provider) {
            c.connected = true;
            c.next_allowed_at = 0; // allow an immediate fetch on explicit connect
        }
    }
    do_refresh(&state, &provider)
}

#[tauri::command]
pub fn usage_disconnect(provider: String, state: tauri::State<UsageState>) {
    state.0.lock().unwrap().remove(&provider);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(label: &str, used: f32) -> QuotaWindow {
        QuotaWindow { label: label.into(), used_pct: used, resets_at: None }
    }

    #[test]
    fn most_constrained_picks_highest_used() {
        let ws = vec![w("5h", 38.0), w("Weekly", 4.0), w("Fable", 2.0)];
        assert_eq!(most_constrained(&ws).unwrap().label, "5h");
    }

    #[test]
    fn most_constrained_empty_is_none() {
        assert!(most_constrained(&[]).is_none());
    }

    #[test]
    fn status_ok_below_threshold() {
        assert_eq!(status_from_windows(&[w("5h", 94.9)]), UsageStatus::Ok);
    }

    #[test]
    fn status_limited_at_threshold() {
        assert_eq!(status_from_windows(&[w("5h", 4.0), w("Weekly", 95.0)]), UsageStatus::Limited);
    }

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(next_backoff_ms(0), 60_000);
        assert_eq!(next_backoff_ms(1), 120_000);
        assert_eq!(next_backoff_ms(4), 960_000);
        assert_eq!(next_backoff_ms(5), 1_800_000); // capped
        assert_eq!(next_backoff_ms(9), 1_800_000); // stays capped
    }

    #[test]
    fn gate_blocks_until_next_allowed() {
        // fetch is allowed only when now >= next_allowed_at
        assert!(fetch_allowed(100, 0));    // no backoff set
        assert!(!fetch_allowed(100, 200)); // still backing off
        assert!(fetch_allowed(300, 200));  // window elapsed
    }
}
