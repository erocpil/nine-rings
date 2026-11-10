use nine_rings_file_host::local_files::{self, LocalFiles};
use std::process::{Command, Stdio};

fn expand(
    arguments: &[String],
    path: &str,
    selected: &[String],
    target: Option<&str>,
) -> Result<Vec<String>, String> {
    if arguments.len() > 64 || arguments.iter().map(String::len).sum::<usize>() > 32768 {
        return Err("最多 64 行参数".into());
    }
    let mut result = Vec::new();
    for argument in arguments {
        if argument == "{files}" {
            if selected.is_empty() {
                return Err("请先选择文件或目录".into());
            }
            result.extend_from_slice(selected);
            continue;
        }
        if argument.contains("{files}") {
            return Err("{files} 必须独占一行".into());
        }
        let mut value = String::new();
        let mut rest = argument.as_str();
        while let Some(start) = rest.find('{') {
            value.push_str(&rest[..start]);
            rest = &rest[start..];
            let Some(end) = rest.find('}') else {
                break;
            };
            let token = &rest[..=end];
            match token {
                "{path}" => value.push_str(path),
                "{target}" => value.push_str(target.ok_or("请先打开另一栏的目标目录")?),
                "{file}" => value.push_str(selected.first().ok_or("请先选择文件或目录")?),
                "{name}" => value.push_str(
                    selected
                        .first()
                        .ok_or("请先选择文件或目录")?
                        .rsplit(['/', '\\'])
                        .next()
                        .unwrap_or_default(),
                ),
                _ => value.push_str(token),
            }
            rest = &rest[end + 1..];
        }
        value.push_str(rest);
        result.push(value);
    }
    if result.len() > 2000
        || result.iter().map(String::len).sum::<usize>() > 128 * 1024
        || result.iter().any(|argument| argument.contains('\0'))
    {
        return Err("展开后的参数过多、过长或含无效字符".into());
    }
    Ok(result)
}
// Only the trusted standalone window invokes this explicitly configured launcher.
// Context is resolved from grants, never interpreted as shell source.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn workbench_run_tool(
    window: tauri::WebviewWindow,
    library: tauri::State<'_, LocalFiles>,
    command: String,
    arguments: Vec<String>,
    root_id: Option<String>,
    node: String,
    selected: Vec<String>,
    target_root_id: Option<String>,
    target_node: Option<String>,
) -> Result<u32, String> {
    super::main_window(&window)?;
    if command.trim().is_empty()
        || command.len() > 4096
        || command.contains(['\0', '\n', '\r'])
        || selected.len() > 2000
    {
        return Err("无效的命令或选中项".into());
    }
    let path = root_id
        .as_ref()
        .map(|root| {
            local_files::local_files_display_path(
                window.clone(),
                library.clone(),
                root.clone(),
                node,
            )
        })
        .transpose()?;
    if let Some(path) = &path {
        if !std::path::Path::new(path).is_dir() {
            return Err("当前路径不是目录".into());
        }
    }
    if path.is_none() && arguments.iter().any(|argument| argument.contains("{path}")) {
        return Err("请先选择授权目录再使用 {path}".into());
    }
    let needs_files = arguments.iter().any(|argument| {
        ["{file}", "{files}", "{name}"]
            .iter()
            .any(|token| argument.contains(token))
    });
    let files = if needs_files {
        if let Some(root) = &root_id {
            selected
                .into_iter()
                .map(|node| {
                    local_files::local_files_display_path(
                        window.clone(),
                        library.clone(),
                        root.clone(),
                        node,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    let target = if arguments
        .iter()
        .any(|argument| argument.contains("{target}"))
    {
        target_root_id
            .map(|root| {
                local_files::local_files_display_path(
                    window.clone(),
                    library.clone(),
                    root,
                    target_node.unwrap_or_default(),
                )
            })
            .transpose()?
    } else {
        None
    };
    let arguments = expand(
        &arguments,
        path.as_deref().unwrap_or_default(),
        &files,
        target.as_deref(),
    )?;
    let mut process = Command::new(command.trim());
    #[cfg(target_os = "macos")]
    if command.trim().ends_with(".app") {
        if !std::path::Path::new(command.trim()).is_dir() {
            return Err("应用程序路径不存在".into());
        }
        process = Command::new("/usr/bin/open");
        process.args(["-a", command.trim(), "--args"]);
    }
    if let Some(path) = path {
        process.current_dir(path);
    }
    process
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let mut child = process
        .spawn()
        .map_err(|error| format!("无法启动程序：{error}"))?;
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::expand;
    #[test]
    fn parameters_are_separate_non_recursive_and_never_shell_escaped() {
        let arguments = [
            "{path}",
            "--file={file}",
            "{name}",
            "{files}",
            "$(echo bad); *",
            "{target}",
        ]
        .map(str::to_string);
        let selected = vec!["/a/{target}.c".into(), "/a/b c.c".into()];
        assert_eq!(
            expand(&arguments, "/a", &selected, Some("/dest")).unwrap(),
            vec![
                "/a",
                "--file=/a/{target}.c",
                "{target}.c",
                "/a/{target}.c",
                "/a/b c.c",
                "$(echo bad); *",
                "/dest"
            ]
        );
        assert!(expand(&["{file}".into()], "/a", &[], None).is_err());
        assert!(expand(&["{target}".into()], "/a", &[], None).is_err());
        assert!(expand(&["x{files}".into()], "/a", &selected, None).is_err());
        assert!(expand(&["\0".into()], "/a", &[], None).is_err());
        assert!(expand(&vec!["a".into(); 65], "/a", &[], None).is_err());
    }
}
