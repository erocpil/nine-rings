/// Only web/email/telephone links may leave the application. Never run a shell
/// with document-provided text, nor allow file/javascript/custom protocols.
fn checked_url(input: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(input).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto" | "tel") {
        return Err("不支持打开此类链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_external_link(url: String) -> Result<(), String> {
    let url = checked_url(&url)?;
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(target.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("系统无法打开链接".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let program = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        std::process::Command::new(program)
            .arg(url.as_str())
            .spawn()
            .map(|mut child| {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::checked_url;
    #[test]
    fn restrict_external_protocols() {
        for url in [
            "https://example.org/?a=1&b=2",
            "mailto:a@example.org",
            "tel:123",
        ] {
            assert!(checked_url(url).is_ok());
        }
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,test",
            "custom:app",
            "not a url",
        ] {
            assert!(checked_url(url).is_err());
        }
    }
}
