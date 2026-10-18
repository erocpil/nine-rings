use serde::Serialize;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    app_bytes: Option<u64>,
    process_memory_bytes: Option<u64>,
}

fn directory_bytes(path: &Path) -> Option<u64> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        return Some(metadata.len());
    }
    if metadata.is_file() {
        return Some(metadata.len());
    }
    if !metadata.is_dir() {
        return Some(0);
    }
    let mut total = 0_u64;
    for entry in std::fs::read_dir(path).ok()? {
        total = total.saturating_add(directory_bytes(&entry.ok()?.path())?);
    }
    Some(total)
}

fn application_bytes(_app: &tauri::AppHandle, executable: Option<PathBuf>) -> Option<u64> {
    let executable = executable?;
    #[cfg(target_os = "macos")]
    {
        let bundle = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|extension| extension == "app"))?;
        directory_bytes(bundle)
    }
    #[cfg(target_os = "windows")]
    {
        directory_bytes(executable.parent()?)
    }
    #[cfg(target_os = "linux")]
    {
        let binary = std::fs::metadata(&executable).ok()?.len();
        let resources = _app.path().resource_dir().ok()?;
        let resource_bytes = directory_bytes(&resources)?;
        Some(binary.saturating_add(resource_bytes))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (_app, executable);
        None
    }
}

fn process_memory_bytes() -> Option<u64> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        return String::from_utf8(output.stdout)
            .ok()?
            .trim()
            .parse::<u64>()
            .ok()
            .map(|kilobytes| kilobytes.saturating_mul(1024));
    }
    #[cfg(windows)]
    {
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("(Get-Process -Id {}).WorkingSet64", std::process::id()),
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        return String::from_utf8(output.stdout)
            .ok()?
            .trim()
            .parse::<u64>()
            .ok();
    }
    #[allow(unreachable_code)]
    None
}

#[tauri::command]
pub async fn get_system_info(app: tauri::AppHandle) -> SystemInfo {
    tauri::async_runtime::spawn_blocking(move || {
        let executable = std::env::current_exe().ok();
        SystemInfo {
            app_bytes: application_bytes(&app, executable),
            process_memory_bytes: process_memory_bytes(),
        }
    })
    .await
    .unwrap_or(SystemInfo {
        app_bytes: None,
        process_memory_bytes: None,
    })
}

#[cfg(test)]
mod tests {
    use super::directory_bytes;
    use std::path::Path;

    #[test]
    fn counts_regular_files_recursively() {
        let root =
            std::env::temp_dir().join(format!("nine-rings-system-info-{}", std::process::id()));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("one"), b"123").unwrap();
        std::fs::write(nested.join("two"), b"45678").unwrap();
        assert_eq!(directory_bytes(Path::new(&root)), Some(8));
        std::fs::remove_dir_all(root).unwrap();
    }
}
