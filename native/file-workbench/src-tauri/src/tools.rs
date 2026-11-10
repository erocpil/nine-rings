use nine_rings_file_host::local_files::{self, LocalFiles};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct ToolJobs(pub Arc<Mutex<BTreeMap<u64, Job>>>);
#[derive(Default)]
pub struct Job {
    process: Option<Arc<Mutex<std::process::Child>>>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    total: usize,
    done: bool,
    readers: u8,
    code: Option<i32>,
    error: Option<String>,
}
impl ToolJobs {
    pub fn active(&self) -> bool {
        self.0.lock().unwrap().values().any(|job| !job.done)
    }
    #[cfg(test)]
    pub fn busy(&self) -> bool {
        self.0
            .lock()
            .unwrap()
            .values()
            .any(|job| !job.done || job.readers > 0)
    }
}
fn read_output(mut source: impl Read, jobs: Arc<Mutex<BTreeMap<u64, Job>>>, id: u64, stderr: bool) {
    let mut buffer = [0; 4096];
    loop {
        match source.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                let mut map = jobs.lock().unwrap();
                let job = map.get_mut(&id).unwrap();
                job.total += n;
                let output = if stderr {
                    &mut job.stderr
                } else {
                    &mut job.stdout
                };
                output.extend_from_slice(&buffer[..n]);
                if output.len() > 131072 {
                    output.drain(..output.len() - 131072);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                jobs.lock().unwrap().get_mut(&id).unwrap().error = Some(error.to_string());
                break;
            }
        }
    }
    jobs.lock().unwrap().get_mut(&id).unwrap().readers -= 1;
}
#[tauri::command]
pub fn workbench_tool_status(
    window: tauri::WebviewWindow,
    jobs: tauri::State<'_, ToolJobs>,
    id: u64,
) -> Result<Value, String> {
    super::main_window(&window)?;
    let map = jobs.0.lock().unwrap();
    let job = map.get(&id).ok_or("执行记录已过期")?;
    Ok(
        json!({"done": job.done && job.readers == 0, "exited": job.done, "code": job.code, "stdout": String::from_utf8_lossy(&job.stdout), "stderr": String::from_utf8_lossy(&job.stderr), "bytes": job.total, "truncated": job.total > job.stdout.len()+job.stderr.len(), "error": job.error}),
    )
}

#[tauri::command]
pub fn workbench_stop_tool(
    window: tauri::WebviewWindow,
    jobs: tauri::State<'_, ToolJobs>,
    id: u64,
) -> Result<(), String> {
    super::main_window(&window)?;
    let process = jobs
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|job| job.process.clone());
    if let Some(process) = process {
        stop_process(&process)?;
    }
    Ok(())
}
fn stop_process(process: &Arc<Mutex<std::process::Child>>) -> Result<(), String> {
    let mut child = process.lock().unwrap();
    if child.try_wait().map_err(|e| e.to_string())?.is_none() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}
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
fn track_child(mut child: std::process::Child, jobs: Arc<Mutex<BTreeMap<u64, Job>>>, id: u64) {
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let output = jobs.clone();
    std::thread::spawn(move || read_output(stdout, output, id, false));
    let output = jobs.clone();
    std::thread::spawn(move || read_output(stderr, output, id, true));
    let process = Arc::new(Mutex::new(child));
    jobs.lock().unwrap().get_mut(&id).unwrap().process = Some(process.clone());
    let output = jobs.clone();
    std::thread::spawn(move || loop {
        let result = process.lock().unwrap().try_wait();
        if matches!(result, Ok(None)) {
            std::thread::sleep(std::time::Duration::from_millis(80));
            continue;
        }
        let mut map = output.lock().unwrap();
        let job = map.get_mut(&id).unwrap();
        job.done = true;
        job.process = None;
        match result {
            Ok(Some(status)) => job.code = status.code(),
            Err(error) => job.error = Some(error.to_string()),
            _ => unreachable!(),
        }
        break;
    });
}
// Only the trusted standalone window invokes this explicitly configured launcher.
// Context is resolved from grants, never interpreted as shell source.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn workbench_run_tool(
    window: tauri::WebviewWindow,
    library: tauri::State<'_, LocalFiles>,
    jobs: tauri::State<'_, ToolJobs>,
    operation: Option<String>,
    expected_plan: Option<Value>,
    command: String,
    arguments: Vec<String>,
    root_id: Option<String>,
    node: String,
    selected: Vec<String>,
    target_root_id: Option<String>,
    target_node: Option<String>,
) -> Result<Value, String> {
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
    let operation = operation.as_deref().unwrap_or("launch");
    if !["launch", "prepare", "capture"].contains(&operation) {
        return Err("未知执行方式".into());
    }
    #[allow(unused_mut)]
    let mut program = command.trim().to_string();
    #[allow(unused_mut)]
    let mut arguments = arguments;
    let mut process = Command::new(&program);
    #[cfg(target_os = "macos")]
    if command.trim().ends_with(".app") {
        if !std::path::Path::new(command.trim()).is_dir() {
            return Err("应用程序路径不存在".into());
        }
        program = "/usr/bin/open".into();
        arguments.splice(0..0, ["-a".into(), command.trim().into(), "--args".into()]);
        process = Command::new(&program);
    }
    let plan = json!({"program": program, "arguments": arguments, "directory": path});
    if operation == "prepare" {
        return Ok(plan);
    }
    if expected_plan.is_some_and(|expected| expected != plan) {
        return Err("文件路径或参数已变化，请重新打开执行预览后确认。".into());
    }
    if let Some(path) = path {
        process.current_dir(path);
    }
    process
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(if operation == "capture" {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stderr(if operation == "capture" {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    // Serialize job admission with spawning; active jobs cannot be evicted.
    let mut map = jobs.0.lock().unwrap();
    if operation == "capture"
        && map
            .values()
            .filter(|job| !job.done || job.readers > 0)
            .count()
            >= 8
    {
        return Err("最多同时运行 8 个命令行工具".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let child = process
        .spawn()
        .map_err(|error| format!("无法启动程序：{error}"))?;
    let pid = child.id();
    if operation == "capture" {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        while map.len() >= 32 {
            if let Some(old) = map
                .iter()
                .find(|(_, job)| job.done && job.readers == 0)
                .map(|(id, _)| *id)
            {
                map.remove(&old);
            } else {
                break;
            }
        }
        map.insert(
            id,
            Job {
                readers: 2,
                ..Job::default()
            },
        );
        drop(map);
        track_child(child, jobs.0.clone(), id);
        Ok(json!({"id": id, "pid": pid}))
    } else {
        drop(map);
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
        Ok(json!(pid))
    }
}

#[cfg(test)]
mod tests {
    use super::expand;
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn stopped_process_is_reaped_and_releases_exit_guard() {
        let child = std::process::Command::new("/bin/sleep")
            .arg("5")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let jobs = super::ToolJobs::default();
        jobs.0.lock().unwrap().insert(
            1,
            super::Job {
                readers: 2,
                ..super::Job::default()
            },
        );
        super::track_child(child, jobs.0.clone(), 1);
        let process = jobs.0.lock().unwrap()[&1].process.clone().unwrap();
        assert!(jobs.active());
        super::stop_process(&process).unwrap();
        let start = std::time::Instant::now();
        while jobs.busy() {
            assert!(start.elapsed().as_secs() < 3);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(!jobs.active());
        assert!(jobs.0.lock().unwrap()[&1].process.is_none());
    }
    #[test]
    fn captured_process_streams_and_nonzero_exit_are_observable() {
        use super::{track_child, Job, ToolJobs};
        use std::process::{Command, Stdio};
        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut value = Command::new("/bin/sh");
            value.args(["-c", "printf 'hello'; printf 'diagnostic' >&2; exit 7"]);
            value
        };
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut value = Command::new("cmd");
            value.args(["/C", "echo hello & echo diagnostic 1>&2 & exit /b 7"]);
            value
        };
        let child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let jobs = ToolJobs::default();
        jobs.0.lock().unwrap().insert(
            1,
            Job {
                readers: 2,
                ..Job::default()
            },
        );
        track_child(child, jobs.0.clone(), 1);
        let start = std::time::Instant::now();
        while jobs.busy() {
            assert!(start.elapsed().as_secs() < 5);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let map = jobs.0.lock().unwrap();
        let job = &map[&1];
        assert_eq!(job.code, Some(7));
        assert!(String::from_utf8_lossy(&job.stdout).contains("hello"));
        assert!(String::from_utf8_lossy(&job.stderr).contains("diagnostic"));
    }
    #[test]
    fn output_is_bounded_and_both_streams_finish_independently() {
        use super::{read_output, Job, ToolJobs};
        let jobs = ToolJobs::default();
        jobs.0.lock().unwrap().insert(
            1,
            Job {
                readers: 2,
                done: true,
                ..Job::default()
            },
        );
        assert!(jobs.busy());
        let mut bytes = vec![b'x'; 200000];
        bytes.extend_from_slice("最后一行".as_bytes());
        read_output(
            std::io::Cursor::new(bytes.clone()),
            jobs.0.clone(),
            1,
            false,
        );
        assert!(jobs.busy());
        read_output(std::io::Cursor::new(b"error"), jobs.0.clone(), 1, true);
        assert!(!jobs.busy());
        let map = jobs.0.lock().unwrap();
        let job = &map[&1];
        assert_eq!(job.stdout.len(), 131072);
        assert!(job.stdout.ends_with("最后一行".as_bytes()));
        assert_eq!(job.stderr, b"error");
        assert_eq!(job.total, bytes.len() + 5);
    }
    #[test]
    fn read_failure_releases_job_and_preserves_diagnostic() {
        struct Broken;
        impl std::io::Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("broken pipe"))
            }
        }
        let jobs = super::ToolJobs::default();
        jobs.0.lock().unwrap().insert(
            1,
            super::Job {
                readers: 1,
                done: true,
                ..super::Job::default()
            },
        );
        super::read_output(Broken, jobs.0.clone(), 1, false);
        assert!(!jobs.busy());
        assert_eq!(
            jobs.0.lock().unwrap()[&1].error.as_deref(),
            Some("broken pipe")
        );
    }
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
