//! System keep-awake assertion held while a coding agent is working.
//!
//! The frontend toggles it through `set_keep_awake`; the assertion is an OS
//! inhibitor that exists only while active, so an idle app costs nothing.

use std::sync::Mutex;

/// The held assertion plus the display-gate value it was acquired with, so a
/// power-source change while an agent runs can be noticed and re-applied.
#[derive(Default)]
pub struct KeepAwake(Mutex<Option<(imp::Assertion, bool)>>);

impl KeepAwake {
    pub fn set(&self, active: bool) {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !active {
            *guard = None;
            return;
        }
        // Re-evaluated on every assert, not just the first: the keep-awake
        // heartbeat re-asserts while working, so unplugging mid-run drops -d
        // instead of pinning the display for the rest of the session.
        let want = imp::display_sleep_block_ok();
        if guard.as_ref().is_some_and(|(_, held)| *held == want) {
            return;
        }
        *guard = None; // release the old inhibitor before taking the new one
        *guard = imp::acquire(want).map(|a| (a, want));
    }
}

#[tauri::command]
pub fn set_keep_awake(state: tauri::State<'_, KeepAwake>, active: bool) {
    state.set(active);
}

#[cfg(unix)]
mod imp {
    use std::process::{Child, Command, Stdio};

    pub struct Assertion(Child);

    // Both inhibitors watch the Pide pid and exit on their own when Pide
    // dies, so even a SIGKILL cannot leave the machine permanently awake.
    pub fn inhibit_command(display_allowed: bool) -> (&'static str, Vec<String>) {
        let pid = std::process::id().to_string();
        #[cfg(target_os = "macos")]
        {
            // -d keeps the display awake (matches ORCA's prevent-display-sleep);
            // without it the screen sleeps and locks even though the system
            // stays up. On battery we drop -d: the screen is the largest power
            // draw and the agent keeps running without it.
            let mut args: Vec<String> = Vec::with_capacity(5);
            if display_allowed {
                args.push("-d".into());
            }
            args.extend(["-i".into(), "-s".into(), "-w".into(), pid]);
            ("/usr/bin/caffeinate", args)
        }
        #[cfg(not(target_os = "macos"))]
        {
            (
                "systemd-inhibit",
                vec![
                    "--what=sleep:idle".into(),
                    "--who=Pide".into(),
                    "--why=A coding agent is running".into(),
                    "--mode=block".into(),
                    "tail".into(),
                    format!("--pid={pid}"),
                    "-f".into(),
                    "/dev/null".into(),
                ],
            )
        }
    }

    /// True when holding a display-sleep assertion is acceptable. False on
    /// battery: keep the system awake for the agent, but let the screen sleep.
    /// Checked at acquire time; plugging in mid-session upgrades on the next
    /// assertion cycle.
    pub fn display_sleep_block_ok() -> bool {
        #[cfg(target_os = "macos")]
        {
            !is_on_battery()
        }
        #[cfg(not(target_os = "macos"))]
        {
            true
        }
    }

    /// Best-effort AC-power probe. Errors default to false (treat as on
    /// battery) so a failed check can only ever reduce power draw, never
    /// increase it.
    #[cfg(target_os = "macos")]
    fn is_on_battery() -> bool {
        match Command::new("/usr/bin/pmset")
            .arg("-g")
            .arg("batt")
            .output()
        {
            Ok(out) => parse_pmset_battery(&String::from_utf8_lossy(&out.stdout)),
            Err(_) => true,
        }
    }

    /// True when pmset reports Battery Power. Pure so the parsing stays testable.
    #[cfg(target_os = "macos")]
    pub(super) fn parse_pmset_battery(output: &str) -> bool {
        output.contains("Battery Power")
    }

    pub fn acquire(display_allowed: bool) -> Option<Assertion> {
        let (program, args) = inhibit_command(display_allowed);
        match Command::new(program)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => Some(Assertion(child)),
            Err(e) => {
                log::warn!("keep-awake inhibitor failed to spawn: {e}");
                None
            }
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::mpsc::{channel, Sender};
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    // ES_CONTINUOUS is per-thread state, so a dedicated thread holds it.
    // Dropping the sender unblocks recv, which clears the state and exits.
    pub struct Assertion(#[allow(dead_code)] Sender<()>);

    /// Windows has no cheap AC probe here; always allow the display flag.
    pub fn display_sleep_block_ok() -> bool {
        true
    }

    pub fn acquire(display_allowed: bool) -> Option<Assertion> {
        let (tx, rx) = channel::<()>();
        let flags = if display_allowed {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        } else {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        };
        std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || {
                unsafe { SetThreadExecutionState(flags) };
                let _ = rx.recv();
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            })
            .ok()?;
        Some(Assertion(tx))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn inhibitor_watches_own_pid() {
        let (program, args) = super::imp::inhibit_command(true);
        let pid = std::process::id().to_string();
        assert!(!program.is_empty());
        assert!(args.iter().any(|a| a.contains(&pid)));
    }

    #[cfg(unix)]
    #[test]
    fn inhibitor_always_blocks_system_and_idle_sleep() {
        let (_, args) = super::imp::inhibit_command(false);
        assert!(args.contains(&"-s".into()));
        assert!(args.contains(&"-i".into()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_display_flag_tracks_battery_gate() {
        let (_, args) = super::imp::inhibit_command(true);
        assert_eq!(args[..4], ["-d", "-i", "-s", "-w"]);

        let (_, args) = super::imp::inhibit_command(false);
        assert!(!args.contains(&"-d".into()), "battery must drop -d");
        assert_eq!(args[..3], ["-i", "-s", "-w"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pmset_parse_detects_power_source() {
        use super::imp::parse_pmset_battery;
        assert!(parse_pmset_battery(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 72%; discharging"
        ));
        assert!(!parse_pmset_battery(
            "Now drawing from 'AC Power'\n -InternalBattery-0 72%; charging"
        ));
        assert!(!parse_pmset_battery("garbage"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_caffeinate() {
        let (program, args) = super::imp::inhibit_command(true);
        assert_eq!(program, "/usr/bin/caffeinate");
        assert_eq!(args[..4], ["-d", "-i", "-s", "-w"]);
    }
}
