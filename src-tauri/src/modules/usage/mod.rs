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
}
