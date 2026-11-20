use nine_rings_file_host::local_files::LocalFiles;
use std::{
    ffi::OsString,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const MAX_FILES: usize = 32;

pub struct Requests(pub tauri::async_runtime::Sender<Vec<PathBuf>>);

pub fn argument_paths(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
    let mut positional = false;
    args.into_iter()
        .filter_map(|arg| {
            if !positional && arg == "--" {
                positional = true;
                return None;
            }
            if arg.is_empty() || (!positional && arg.to_string_lossy().starts_with('-')) {
                return None;
            }
            let path = PathBuf::from(arg);
            if path.is_absolute() {
                Some(path)
            } else if cwd.is_absolute() {
                Some(cwd.join(path))
            } else {
                None
            }
        })
        .take(MAX_FILES + 1)
        .collect()
}

fn normalized_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("需要可确定的绝对文件路径".into());
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir if !clean.pop() => return Err("无效的上级路径".into()),
            Component::ParentDir | Component::CurDir => {}
            _ => clean.push(component),
        }
    }
    Ok(clean)
}

fn authorized_target(
    library: &LocalFiles,
    requested: &Path,
) -> Result<(PathBuf, String, String), String> {
    let normalized = normalized_path(requested)?;
    let (root_id, node) = library
        .authorized_document_origin(&normalized)?
        .ok_or("文件未处于可访问的授权目录中，请先在 File Workbench 添加该目录")?;
    if requested != normalized {
        // Check the original components as well as the normalized grant path.
        // A parent component can otherwise hide a symlink even if both paths resolve identically.
        let ancestors: Vec<_> = requested.ancestors().collect();
        for ancestor in ancestors.into_iter().rev() {
            if std::fs::symlink_metadata(ancestor)
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("请使用实际文件路径打开文件".into());
            }
        }
        if std::fs::canonicalize(requested).map_err(|error| error.to_string())? != normalized {
            return Err("路径与授权文件不一致，请使用实际文件路径".into());
        }
    }
    Ok((normalized, root_id, node))
}

fn show_error(app: &tauri::AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("File Workbench · 打开文件")
        .kind(MessageDialogKind::Warning)
        .show(|_| {});
}

/// Only native startup and file-open events feed this queue.
pub fn submit(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) -> bool {
    let paths: Vec<_> = paths.into_iter().take(MAX_FILES + 1).collect();
    if paths.is_empty() {
        return false;
    }
    if app.state::<Requests>().0.try_send(paths).is_err() {
        show_error(app, "打开文件请求过多，请稍后重试。".into());
    }
    true
}

pub async fn process(
    app: tauri::AppHandle,
    mut requests: tauri::async_runtime::Receiver<Vec<PathBuf>>,
) {
    let restore_app = app.clone();
    match tauri::async_runtime::spawn_blocking(move || super::editor_window::restore(&restore_app))
        .await
    {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("Editor restore: {error}"),
        Err(error) => eprintln!("Editor restore: {error}"),
    }
    while let Some(paths) = requests.recv().await {
        let opener = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut errors = Vec::new();
            if paths.len() > MAX_FILES {
                errors.push("一次最多打开 32 个文件。".to_owned());
            }
            for path in paths.into_iter().take(MAX_FILES) {
                let result = authorized_target(&opener.state::<LocalFiles>(), &path).and_then(
                    |(path, root_id, node)| {
                        super::editor_window::open_native_path(&opener, &path, root_id, node)
                    },
                );
                if let Err(error) = result {
                    let name = path
                        .file_name()
                        .unwrap_or(path.as_os_str())
                        .to_string_lossy();
                    errors.push(format!("{name}：{error}"));
                }
            }
            errors
        })
        .await;
        match result {
            Ok(errors) if !errors.is_empty() => show_error(&app, errors.join("\n")),
            Err(error) => show_error(&app, error.to_string()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_cli_paths_using_the_invoking_instances_working_directory() {
        let cwd = std::env::current_dir().unwrap();
        let absolute = cwd.join("absolute.md");
        let args = vec![
            OsString::from("-psn_0_42"),
            OsString::from("note with spaces.md"),
            absolute.clone().into_os_string(),
            OsString::from("--"),
            OsString::from("-draft.md"),
        ];
        assert_eq!(
            argument_paths(args, &cwd),
            [
                cwd.join("note with spaces.md"),
                absolute,
                cwd.join("-draft.md")
            ],
        );
        assert!(argument_paths([OsString::from("relative.md")], Path::new("")).is_empty());
        assert_eq!(
            normalized_path(&cwd.join("notes/../draft.md")).unwrap(),
            cwd.join("draft.md"),
        );
    }

    #[test]
    fn requires_existing_directory_grants_and_rejects_indirect_paths() {
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let path = std::env::temp_dir().join(format!(
            "workbench-native-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir(&path).unwrap();
        let fixture = Fixture(path);
        let base = fixture.0.canonicalize().unwrap();
        let root = base.join("granted");
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let note = root.join("课程 (1).md");
        let outside = base.join("outside.md");
        std::fs::write(&note, "# Lesson").unwrap();
        std::fs::write(&outside, "# Outside").unwrap();
        std::fs::write(
            base.join("local-file-roots.json"),
            serde_json::json!([{ "id": "existing", "path": root }]).to_string(),
        )
        .unwrap();
        let library = LocalFiles::load(&base);
        assert_eq!(
            authorized_target(&library, &nested.join("../课程 (1).md")).unwrap(),
            (note.clone(), "existing".into(), "课程 (1).md".into()),
        );
        assert!(authorized_target(&library, &outside).is_err());
        assert!(authorized_target(&library, &nested).is_err());
        #[cfg(unix)]
        {
            let symlink = root.join("link.md");
            std::os::unix::fs::symlink(&note, &symlink).unwrap();
            assert!(authorized_target(&library, &symlink).is_err());
            let outside_tree = base.join("other");
            std::fs::create_dir_all(outside_tree.join("child")).unwrap();
            std::fs::write(outside_tree.join("课程 (1).md"), "# Another file").unwrap();
            std::os::unix::fs::symlink(outside_tree.join("child"), root.join("alias")).unwrap();
            assert!(authorized_target(&library, &root.join("alias/../课程 (1).md")).is_err());
            std::os::unix::fs::symlink(&nested, root.join("inside-alias")).unwrap();
            assert!(
                authorized_target(&library, &root.join("inside-alias/../课程 (1).md")).is_err()
            );
        }
    }
}
