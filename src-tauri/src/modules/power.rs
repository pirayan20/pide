//! System keep-awake assertion held while a coding agent is working.
//!
//! The frontend toggles it through `set_keep_awake`; the assertion is an OS
//! inhibitor that exists only while active, so an idle app costs nothing.

use std::sync::Mutex;

#[derive(Default)]
pub struct KeepAwake(Mutex<Option<imp::Assertion>>);

impl KeepAwake {
    pub fn set(&self, active: bool) {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if active == guard.is_some() {
            return;
        }
        *guard = if active { imp::acquire() } else { None };
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
    pub fn inhibit_command() -> (&'static str, Vec<String>) {
        let pid = std::process::id().to_string();
        #[cfg(target_os = "macos")]
        {
            // -d keeps the display awake too (matches ORCA's prevent-display-sleep);
            // without it the screen sleeps and locks even though the system stays up.
            ("/usr/bin/caffeinate", vec!["-d".into(), "-i".into(), "-s".into(), "-w".into(), pid])
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

    pub fn acquire() -> Option<Assertion> {
        let (program, args) = inhibit_command();
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

    pub fn acquire() -> Option<Assertion> {
        let (tx, rx) = channel::<()>();
        std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || {
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
                };
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
        let (program, args) = super::imp::inhibit_command();
        let pid = std::process::id().to_string();
        assert!(!program.is_empty());
        assert!(args.iter().any(|a| a.contains(&pid)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_caffeinate() {
        let (program, args) = super::imp::inhibit_command();
        assert_eq!(program, "/usr/bin/caffeinate");
        assert_eq!(args[..4], ["-d", "-i", "-s", "-w"]);
    }
}
