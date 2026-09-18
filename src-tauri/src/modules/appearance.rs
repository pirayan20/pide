fn validate_window(label: &str) -> Result<(), String> {
    match label {
        "main" | "settings" => Ok(()),
        _ => Err("Window appearance is only available for Pide windows".into()),
    }
}

#[tauri::command]
pub fn set_window_blur(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    validate_window(window.label())?;
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        // Clear first so hot reloads and repeated requests never stack effect views.
        window_vibrancy::clear_vibrancy(&window).map_err(|e| e.to_string())?;
        if enabled {
            window_vibrancy::apply_vibrancy(
                &window,
                NSVisualEffectMaterial::Selection,
                Some(NSVisualEffectState::Active),
                None,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        if enabled {
            window_vibrancy::apply_acrylic(&window, None)
        } else {
            window_vibrancy::clear_acrylic(&window)
        }
        .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::validate_window;

    #[test]
    fn appearance_is_limited_to_app_owned_windows() {
        assert!(validate_window("main").is_ok());
        assert!(validate_window("settings").is_ok());
        assert!(validate_window("preview").is_err());
        assert!(validate_window("").is_err());
    }
}
