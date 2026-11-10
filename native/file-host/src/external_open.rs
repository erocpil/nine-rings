//! OS handoff only: no shell interpolation, association changes, or automatic launch.
use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(not(target_os = "windows"))]
fn command(path: &Path, application: Option<&Path>) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        if let Some(application) = application {
            command.arg("-a").arg(application);
        }
        command.arg(path);
        command
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut command = Command::new(if application.is_some() {
            "gio"
        } else {
            "xdg-open"
        });
        if let Some(application) = application {
            command.arg("launch").arg(application);
        }
        command.arg(path);
        command
    }
}
pub(crate) fn application(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("请选择应用程序的完整路径".into());
    }
    #[cfg(target_os = "macos")]
    let valid = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        && path.is_dir();
    #[cfg(target_os = "windows")]
    let valid = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        && path.is_file();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let valid = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("desktop"))
        && path.is_file();
    if !valid {
        return Err("所选项目不是受支持的应用程序".into());
    }
    std::fs::canonicalize(path).map_err(|error| error.to_string())
}
pub(crate) fn launch(path: &Path, application: Option<&Path>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        if let Some(application) = application {
            let mut child = Command::new(application)
                .arg(path)
                .spawn()
                .map_err(|e| e.to_string())?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(());
        }
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
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
            return Err("系统无法打开此文件，请选择其它应用程序".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // open returns after LaunchServices handoff. xdg-open/gio may stay alive
        // with the chosen app: reap on a worker instead of blocking the UI.
        #[cfg(target_os = "macos")]
        {
            let output = command(path, application)
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!(
                    "系统打开失败：{}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let mut child = command(path, application)
                .spawn()
                .map_err(|e| e.to_string())?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative_or_non_application_paths() {
        assert!(application(Path::new("editor.app")).is_err());
        assert!(application(Path::new("/tmp/ordinary.txt")).is_err());
    }
    #[test]
    fn accepts_only_a_selected_platform_application_kind() {
        let area = std::env::temp_dir().join(format!("nr-open-app-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&area).unwrap();
        #[cfg(target_os = "macos")]
        let selected = area.join("Some Editor.app");
        #[cfg(target_os = "windows")]
        let selected = area.join("Some Editor.exe");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let selected = area.join("Some Editor.desktop");
        #[cfg(target_os = "macos")]
        std::fs::create_dir(&selected).unwrap();
        #[cfg(not(target_os = "macos"))]
        std::fs::write(&selected, "test fixture; never executed").unwrap();
        assert_eq!(
            application(&selected).unwrap(),
            std::fs::canonicalize(&selected).unwrap()
        );
        std::fs::remove_dir_all(area).unwrap();
    }
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn filenames_and_apps_are_literal_arguments_not_shell_commands() {
        let path = Path::new("/tmp/a ; $(touch unsafe) 中文.txt");
        let application = Path::new("/Applications/Some Editor.app");
        let cmd = command(path, Some(application));
        let args: Vec<_> = cmd.get_args().collect();
        #[cfg(target_os = "macos")]
        assert_eq!(
            args,
            [
                std::ffi::OsStr::new("-a"),
                application.as_os_str(),
                path.as_os_str()
            ]
        );
        #[cfg(not(target_os = "macos"))]
        assert_eq!(
            args,
            [
                std::ffi::OsStr::new("launch"),
                application.as_os_str(),
                path.as_os_str()
            ]
        );
        assert_eq!(
            command(path, None).get_args().collect::<Vec<_>>(),
            [path.as_os_str()]
        );
    }
}
