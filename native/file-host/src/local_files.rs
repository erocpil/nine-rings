//! Scoped local-file grants. Deliberately independent of image grants and document storage.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
const MAX_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    source: String,
    revision: String,
    bom: bool,
    line_ending: String,
    modified_ms: u128,
    size: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    modified_ms: u128,
    size: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentDigest {
    digest: String,
    size: u64,
    modified_ms: u128,
}
const MAX_DIGEST_BYTES: u64 = 256 * 1024 * 1024;

#[cfg(test)]
mod digest_tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("nr-digest-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn raw_digest_is_binary_safe_bounded_and_checks_exact_length() {
        for bytes in [vec![], vec![0, 255, 1, 13, 10], vec![17; 5 * 1024 * 1024]] {
            assert_eq!(
                digest_stream(bytes.as_slice(), bytes.len() as u64).unwrap(),
                format!("{:x}", Sha256::digest(&bytes))
            );
        }
        assert!(digest_stream(&b"ab"[..], 1).unwrap_err().contains("增长"));
        assert!(digest_stream(&b"a"[..], 2).unwrap_err().contains("截断"));
        assert!(digest_stream(&b""[..], MAX_DIGEST_BYTES + 1)
            .unwrap_err()
            .contains("256 MiB"));
        struct Failure;
        impl Read for Failure {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("read failed"))
            }
        }
        assert!(digest_stream(Failure, 1)
            .unwrap_err()
            .contains("read failed"));
    }
    #[test]
    fn digest_is_scoped_readonly_and_rejects_directories_and_oversized_files() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("data.bin"), [0, 255, 9]).unwrap();
        let result = content_digest(&fixture.0, "data.bin").unwrap();
        assert_eq!(result.size, 3);
        assert_eq!(result.digest, format!("{:x}", Sha256::digest([0, 255, 9])));
        assert_eq!(fs::read(fixture.0.join("data.bin")).unwrap(), [0, 255, 9]);
        assert!(content_digest(&fixture.0, "../escape").is_err());
        assert!(content_digest(&fixture.0, "").is_err());
        fs::create_dir(fixture.0.join("dir")).unwrap();
        assert!(content_digest(&fixture.0, "dir").is_err());
        fs::File::create(fixture.0.join("large.bin"))
            .unwrap()
            .set_len(MAX_DIGEST_BYTES + 1)
            .unwrap();
        assert!(content_digest(&fixture.0, "large.bin")
            .unwrap_err()
            .contains("256 MiB"));
    }
    #[test]
    fn digest_identity_detects_replacement_and_rejects_links() {
        let fixture = Fixture::new();
        let path = fixture.0.join("data");
        fs::write(&path, [0, 1]).unwrap();
        let before = fs::metadata(&path).unwrap();
        assert!(same_digest_identity(&before, &fs::metadata(&path).unwrap()));
        fs::write(&path, [0, 1, 2]).unwrap();
        assert!(!same_digest_identity(
            &before,
            &fs::metadata(&path).unwrap()
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&path, fixture.0.join("link")).unwrap();
            assert!(content_digest(&fixture.0, "link").is_err());
            fs::write(fixture.0.join("other"), [0, 1]).unwrap();
            assert!(!same_digest_identity(
                &before,
                &fs::metadata(fixture.0.join("other")).unwrap()
            ));
        }
    }
}

fn digest_stream(reader: impl Read, length: u64) -> Result<String, String> {
    if length > MAX_DIGEST_BYTES {
        return Err("摘要比较单文件最多 256 MiB".into());
    }
    let mut reader = reader.take(length + 1);
    let mut buffer = [0u8; 65536];
    let mut hash = Sha256::new();
    let mut read = 0;
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        read += count as u64;
        if read > length {
            return Err("摘要读取期间文件增长".into());
        }
        hash.update(&buffer[..count]);
    }
    if read != length {
        return Err("摘要读取期间文件截断".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn same_digest_identity(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if a.dev() != b.dev() || a.ino() != b.ino() {
            return false;
        }
    }
    a.is_file()
        && b.is_file()
        && !is_link(a)
        && !is_link(b)
        && a.len() == b.len()
        && a.modified().ok() == b.modified().ok()
        && a.created().ok() == b.created().ok()
}
fn content_digest(root: &Path, node: &str) -> Result<ContentDigest, String> {
    if node.is_empty() {
        return Err("请选择普通文件".into());
    }
    let path = checked_path(root, node)?;
    let before = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !before.is_file() || is_link(&before) {
        return Err("摘要仅支持普通文件".into());
    }
    // Check the budget before opening: never wait on a device/pipe or allocate
    // a buffer proportional to the file. The bounded stream rejects growth.
    if before.len() > MAX_DIGEST_BYTES {
        return Err("摘要比较单文件最多 256 MiB".into());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    if !same_digest_identity(&before, &file.metadata().map_err(|e| e.to_string())?) {
        return Err("摘要打开期间文件变化".into());
    }
    let digest = digest_stream(&file, before.len())?;
    let current = checked_path(root, node)?;
    if path != current
        || !same_digest_identity(&before, &file.metadata().map_err(|e| e.to_string())?)
        || !same_digest_identity(
            &before,
            &fs::symlink_metadata(current).map_err(|e| e.to_string())?,
        )
    {
        return Err("摘要读取期间文件变化".into());
    }
    Ok(ContentDigest {
        digest,
        size: before.len(),
        modified_ms: before
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    })
}
#[tauri::command]
pub async fn local_files_digest(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<ContentDigest, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let expected = root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || content_digest(&root, &node))
        .await
        .map_err(|e| e.to_string())??;
    if library.root(&root_id)? != expected {
        return Err("目录授权已变化".into());
    }
    Ok(result)
}
#[derive(Default)]
pub struct LocalFiles {
    roots: Arc<Mutex<HashMap<String, PathBuf>>>,
    grants_path: Option<PathBuf>,
}
#[derive(Serialize, Deserialize)]
struct Grant {
    id: String,
    path: PathBuf,
}
#[derive(Serialize)]
pub struct Root {
    id: String,
    name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    id: String,
    name: String,
    directory: bool,
    size: u64,
    modified_ms: u128,
}
#[derive(Serialize)]
pub struct Page {
    nodes: Vec<Node>,
    next: Option<usize>,
}
fn caller(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("文件目录仅允许主窗口访问".into());
    }
    Ok(())
}
fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn checked_path(root: &Path, node: &str) -> Result<PathBuf, String> {
    if !root.is_dir()
        || is_link(&fs::symlink_metadata(root).map_err(|e| e.to_string())?)
        || fs::canonicalize(root).map_err(|e| e.to_string())? != root
    {
        return Err("授权目录已变化，请重新选择".into());
    }
    if node.contains(['\\', ':', '\0'])
        || (!node.is_empty()
            && node
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == ".."))
    {
        return Err("无效的文件节点".into());
    }
    let mut path = root.to_path_buf();
    for part in Path::new(node).components() {
        if !matches!(part, Component::Normal(_)) {
            return Err("无效的文件节点".into());
        }
        path.push(part);
        if is_link(&fs::symlink_metadata(&path).map_err(|e| e.to_string())?) {
            return Err("不读取符号链接".into());
        }
    }
    let resolved = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !resolved.starts_with(root) {
        return Err("文件超出授权目录".into());
    }
    Ok(resolved)
}
impl LocalFiles {
    pub fn load(dir: &Path) -> Self {
        let grants: Vec<Grant> = fs::read(dir.join("local-file-roots.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            grants_path: Some(dir.join("local-file-roots.json")),
            roots: Arc::new(Mutex::new(
                grants.into_iter().map(|g| (g.id, g.path)).collect(),
            )),
        }
    }
    fn root(&self, id: &str) -> Result<PathBuf, String> {
        self.roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .get(id)
            .cloned()
            .ok_or("目录授权已撤销".into())
    }
    fn revoke_root(&self, id: &str) -> Result<(), String> {
        let mut roots = self.roots.lock().map_err(|_| "目录状态不可用")?;
        let data: Vec<Grant> = roots
            .iter()
            .filter(|(key, _)| key.as_str() != id)
            .map(|(key, path)| Grant {
                id: key.clone(),
                path: path.clone(),
            })
            .collect();
        // Keep the in-memory grant on persistence failure; never revoke by path prefix.
        fs::write(
            self.grants_path.as_ref().ok_or("授权记录目录尚未初始化")?,
            serde_json::to_vec(&data).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        roots.remove(id);
        Ok(())
    }
    fn save(&self, _app: &tauri::AppHandle) -> Result<(), String> {
        self.persist()
    }
    fn persist(&self) -> Result<(), String> {
        let data: Vec<Grant> = self
            .roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .iter()
            .map(|(id, path)| Grant {
                id: id.clone(),
                path: path.clone(),
            })
            .collect();
        fs::write(
            self.grants_path.as_ref().ok_or("授权记录目录尚未初始化")?,
            serde_json::to_vec(&data).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub async fn local_files_choose(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<Root>, String> {
    caller(&window)?;
    let picker = app.clone();
    let chosen =
        tauri::async_runtime::spawn_blocking(move || picker.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = fs::canonicalize(chosen.into_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !path.is_dir() {
        return Err("请选择目录".into());
    }
    let library = app.state::<LocalFiles>();
    let id = uuid::Uuid::new_v4().to_string();
    library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .insert(id.clone(), path.clone());
    if let Err(error) = library.save(&app) {
        library
            .roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .remove(&id);
        return Err(error);
    }
    Ok(Some(Root {
        id,
        name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned(),
    }))
}
fn file_properties(root: &Path, node: &str) -> Result<(PathBuf, serde_json::Value), String> {
    let path = checked_path(root, node)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let millis = |time: std::io::Result<std::time::SystemTime>| {
        time.ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
    };
    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        format!("{:o}", meta.permissions().mode() & 0o7777)
    };
    #[cfg(not(unix))]
    let permissions = if meta.permissions().readonly() {
        "只读".to_string()
    } else {
        "可写".to_string()
    };
    let details = serde_json::json!({ "path": path.to_string_lossy(), "size": meta.len(), "modifiedMs": millis(meta.modified()), "createdMs": millis(meta.created()), "accessedMs": millis(meta.accessed()), "readonly": meta.permissions().readonly(), "permissions": permissions, "directory": meta.is_dir(), "systemShown": false });
    Ok((path, details))
}
#[tauri::command]
pub async fn local_files_properties(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    system: bool,
) -> Result<serde_json::Value, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let roots = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (path, mut details) = file_properties(&root, &node)?;
        if roots.lock().map_err(|_| "目录状态不可用")?.get(&root_id) != Some(&root)
            || checked_path(&root, &node)? != path
        {
            return Err("目录授权或文件已变化".into());
        }
        details["systemShown"] =
            serde_json::json!(system && super::external_open::properties(&path)?);
        Ok(details)
    })
    .await
    .map_err(|e| e.to_string())?
}
// A user-invoked OS handoff is deliberately separate from text reading and
// never changes file associations. The app path comes only from a native picker.
#[tauri::command]
pub async fn local_files_open_external(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    choose_application: bool,
) -> Result<bool, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let original = external_target(&root, &node)?;
    let application = if choose_application {
        let picker = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择用于打开文件的应用程序");
        #[cfg(target_os = "macos")]
        let picker = picker
            .set_directory("/Applications")
            .add_filter("应用程序", &["app"]);
        #[cfg(target_os = "windows")]
        let picker = picker.add_filter("应用程序", &["exe"]);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let picker = picker
            .set_directory("/usr/share/applications")
            .add_filter("应用程序", &["desktop"]);
        let selected = tauri::async_runtime::spawn_blocking(move || picker.blocking_pick_file())
            .await
            .map_err(|e| e.to_string())?;
        let Some(selected) = selected else {
            return Ok(false);
        };
        Some(super::external_open::application(
            &selected.into_path().map_err(|e| e.to_string())?,
        )?)
    } else {
        None
    };
    // Recheck scope after the OS picker; a revoked/moved grant cannot launch.
    if library.root(&root_id)? != root || external_target(&root, &node)? != original {
        return Err("文件或目录授权已变化，请重新选择".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        super::external_open::launch(&original, application.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(true)
}
fn external_target(root: &Path, node: &str) -> Result<PathBuf, String> {
    if node.is_empty() {
        return Err("请选择一个文件".into());
    }
    let path = checked_path(root, node)?;
    if !path.is_file() {
        return Err("打开方式仅用于普通文件".into());
    }
    Ok(path)
}
#[tauri::command]
pub fn local_files_roots(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
) -> Result<Vec<Root>, String> {
    caller(&window)?;
    Ok(library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .iter()
        .map(|(id, path)| Root {
            id: id.clone(),
            name: path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .into_owned(),
        })
        .collect())
}
#[tauri::command]
pub fn local_files_display_path(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<String, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    Ok(checked_path(&root, &node)?.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn local_files_remove(
    _app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
) -> Result<(), String> {
    caller(&window)?;
    library.revoke_root(&root_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    root: Root,
    node_id: String,
}
fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.trim() != name
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', ':', '\0'])
    {
        return Err("名称不能为空，也不能包含路径分隔符".into());
    }
    Ok(())
}
// Never replace an entry created by another process between validation and rename.
fn move_exclusive(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let from = std::ffi::CString::new(source.as_os_str().as_bytes())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
        let to = std::ffi::CString::new(target.as_os_str().as_bytes())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "当前平台不支持安全移动",
        ));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                windows::core::PCWSTR(from.as_ptr()),
                windows::core::PCWSTR(to.as_ptr()),
                MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0 & 0xffff))?;
    }
    Ok(())
}
fn create_entry(root: &Path, parent: &str, name: &str, directory: bool) -> Result<String, String> {
    valid_name(name)?;
    let parent_path = checked_path(root, parent)?;
    if !parent_path.is_dir() {
        return Err("目标不是目录".into());
    }
    let target = parent_path.join(name);
    if directory {
        fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
    }
    Ok(if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    })
}
#[tauri::command]
pub async fn local_files_create(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    parent: String,
    name: String,
    directory: bool,
) -> Result<String, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let grants = grants.lock().map_err(|_| "目录状态不可用")?;
        if grants.get(&root_id) != Some(&root) {
            return Err("目录授权已变化".into());
        }
        create_entry(&root, &parent, &name, directory)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn move_entry(root: &Path, node: &str, parent: &str, name: &str) -> Result<String, String> {
    if node.is_empty() {
        return Err("不能移动授权根目录".into());
    }
    valid_name(name)?;
    let source = checked_path(root, node)?;
    let destination = checked_path(root, parent)?;
    if !destination.is_dir() || destination.starts_with(&source) {
        return Err("不能移动到自身或其子目录".into());
    }
    let target = destination.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err("目标名称已存在，未覆盖".into());
    }
    move_exclusive(&source, &target).map_err(|e| e.to_string())?;
    Ok(if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    })
}
// Copy into an operation-owned staging directory. The final exclusive rename
// never replaces an existing destination, even when another process creates it.
fn copy_tree(
    source: &Path,
    target: &Path,
    depth: usize,
    remaining: &mut usize,
) -> Result<(), String> {
    if depth > 64 || *remaining == 0 {
        return Err("复制超过目录深度或 10000 项预算".into());
    }
    *remaining -= 1;
    let meta = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if is_link(&meta) {
        return Err("不复制符号链接或重解析点".into());
    }
    if meta.is_dir() {
        super::local_file_transfer::create_private_directory(target).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_tree(
                &entry.path(),
                &target.join(entry.file_name()),
                depth + 1,
                remaining,
            )?;
        }
        fs::set_permissions(target, meta.permissions()).map_err(|e| e.to_string())?;
        super::local_file_transfer::sync_directory(target)?;
    } else if meta.is_file() {
        // Keep platform copy semantics (including Windows named streams),
        // rather than replacing the existing native copy with a text buffer.
        let copied = fs::copy(source, target).map_err(|e| e.to_string())?;
        if copied != meta.len() {
            return Err("复制期间源文件长度发生变化".into());
        }
        super::local_file_transfer::sync_copied_file(target, meta.permissions())?;
        let after = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
        if is_link(&after)
            || meta.len() != after.len()
            || meta.modified().ok() != after.modified().ok()
        {
            return Err("复制期间源文件发生变化，请刷新后重试".into());
        }
    } else {
        return Err("不复制设备、管道或其它特殊文件".into());
    }
    Ok(())
}
#[cfg(test)]
fn transfer_entry(
    source_root: &Path,
    node: &str,
    target_root: &Path,
    parent: &str,
    name: &str,
    moving: bool,
) -> Result<String, String> {
    guarded_transfer_entry(source_root, node, target_root, parent, name, moving, || {
        Ok(())
    })
}
fn guarded_transfer_entry(
    source_root: &Path,
    node: &str,
    target_root: &Path,
    parent: &str,
    name: &str,
    moving: bool,
    access: impl Fn() -> Result<(), String>,
) -> Result<String, String> {
    access()?;
    if node.is_empty() {
        return Err("不能传输授权根目录".into());
    }
    valid_name(name)?;
    let source = checked_path(source_root, node)?;
    let destination = checked_path(target_root, parent)?;
    if !destination.is_dir() || destination.starts_with(&source) {
        return Err("目标不是目录，或位于源目录内".into());
    }
    let target = destination.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err("TARGET_EXISTS: 目标名称已存在，未覆盖".into());
    }
    if moving {
        super::local_file_transfer::move_with_fallback(
            &source,
            &target,
            || {
                access()?;
                if checked_path(source_root, node)? != source
                    || checked_path(target_root, parent)? != destination
                {
                    return Err("移动期间授权路径发生变化".into());
                }
                Ok(())
            },
            move_exclusive,
            |from, to| copy_tree(from, to, 0, &mut 10000),
            |path| {
                super::local_file_transfer::recycle_verified_source(path)
                    .map_err(|e| format!("移入系统回收站失败（不执行永久删除）：{e}"))
            },
        )?;
    } else {
        let staging = destination.join(format!(".nine-rings-copy-{}", uuid::Uuid::new_v4()));
        super::local_file_transfer::create_private_directory(&staging)
            .map_err(|e| e.to_string())?;
        let item = staging.join("item");
        let result = copy_tree(&source, &item, 0, &mut 10000).and_then(|()| {
            access()?;
            if checked_path(source_root, node)? != source
                || checked_path(target_root, parent)? != destination
            {
                return Err("复制期间授权路径发生变化，未发布目标".into());
            }
            if fs::symlink_metadata(&target).is_ok() {
                return Err("TARGET_EXISTS: 目标名称已存在，未覆盖".into());
            }
            move_exclusive(&item, &target).map_err(|e| e.to_string())
        });
        // Only our newly-created staging directory is ever permanently removed.
        let cleanup = fs::remove_dir_all(&staging);
        result?;
        cleanup.map_err(|e| format!("复制已完成，但临时目录清理失败：{e}"))?;
    }
    Ok(if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    })
}
// Keep the scoped IPC fields flat, matching move/create; two are injected context.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn local_files_transfer(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    target_root_id: String,
    parent: String,
    name: String,
    moving: bool,
) -> Result<String, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let target_root = library.root(&target_root_id)?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Do not hold the global grant mutex over long copies/hashes: other
        // directories must remain browsable while a confirmed job executes.
        guarded_transfer_entry(&root, &node, &target_root, &parent, &name, moving, || {
            let grants = grants.lock().map_err(|_| "目录状态不可用")?;
            if grants.get(&root_id) != Some(&root)
                || grants.get(&target_root_id) != Some(&target_root)
            {
                return Err("目录授权已变化".into());
            }
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_files_move(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let grants = grants.lock().map_err(|_| "目录状态不可用")?;
        if grants.get(&root_id) != Some(&root) {
            return Err("目录授权已变化".into());
        }
        move_entry(&root, &node, &parent, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_files_trash(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<(), String> {
    caller(&window)?;
    if node.is_empty() {
        return Err("不能删除授权根目录；可撤销其授权".into());
    }
    let root = library.root(&root_id)?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let grants = grants.lock().map_err(|_| "目录状态不可用")?;
        if grants.get(&root_id) != Some(&root) {
            return Err("目录授权已变化".into());
        }
        let target = checked_path(&root, &node)?;
        trash::delete(target).map_err(|e| format!("移入系统回收站失败（未执行永久删除）：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn local_files_rename(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    name: String,
) -> Result<RenameResult, String> {
    caller(&window)?;
    if name.trim().is_empty()
        || name.trim() != name
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', ':', '\0'])
    {
        return Err("名称不能为空，也不能包含路径分隔符".into());
    }
    let root = library.root(&root_id)?;
    let source = checked_path(&root, &node)?;
    let parent = source.parent().ok_or("不能重命名文件系统根目录")?;
    let target = parent.join(&name);
    if target.exists() {
        return Err("同名文件或目录已存在".into());
    }
    move_exclusive(&source, &target).map_err(|e| e.to_string())?;
    let updated_root = if node.is_empty() {
        target.clone()
    } else {
        root.clone()
    };
    library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .insert(root_id.clone(), updated_root.clone());
    if let Err(error) = library.save(&app) {
        if move_exclusive(&target, &source).is_ok() {
            library
                .roots
                .lock()
                .map_err(|_| "目录状态不可用")?
                .insert(root_id.clone(), root.clone());
        }
        return Err(error);
    }
    Ok(RenameResult {
        root: Root {
            id: root_id,
            name: updated_root
                .file_name()
                .unwrap_or(updated_root.as_os_str())
                .to_string_lossy()
                .into_owned(),
        },
        node_id: if node.is_empty() {
            String::new()
        } else {
            let parent = node.rsplit_once('/').map(|(parent, _)| parent);
            match parent {
                Some(parent) => format!("{parent}/{name}"),
                None => name,
            }
        },
    })
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum FileSort {
    #[default]
    Name,
    NameDesc,
    Type,
    TypeDesc,
    Size,
    SizeDesc,
    Modified,
    ModifiedDesc,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListOptions {
    sort: FileSort,
    show_hidden: bool,
    query: String,
}
impl Default for ListOptions {
    fn default() -> Self {
        Self {
            sort: FileSort::Name,
            show_hidden: true,
            query: String::new(),
        }
    }
}
fn list_with_options(
    root: &Path,
    node: &str,
    offset: usize,
    options: &ListOptions,
) -> Result<Page, String> {
    if options.query.len() > 1024 {
        return Err("文件名过滤条件过长".into());
    }
    let query = options.query.trim().to_lowercase();
    let path = checked_path(root, node)?;
    let mut nodes = Vec::new();
    for (count, item) in fs::read_dir(path).map_err(|e| e.to_string())?.enumerate() {
        if count >= 10000 {
            return Err("单目录超过 10000 项，请选择更具体的目录".into());
        }
        let item = item.map_err(|e| e.to_string())?;
        let meta = match fs::symlink_metadata(item.path()) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if is_link(&meta) || (!meta.is_dir() && !meta.is_file()) {
            continue;
        }
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };
        if name.contains(['\\', ':', '\0']) {
            continue;
        }
        let hidden = name.starts_with('.');
        #[cfg(windows)]
        let hidden = {
            use std::os::windows::fs::MetadataExt;
            hidden || meta.file_attributes() & 0x2 != 0
        };
        if !options.show_hidden && hidden {
            continue;
        }
        if !meta.is_dir() && !query.is_empty() && !name.to_lowercase().contains(&query) {
            continue;
        }
        nodes.push(Node {
            id: if node.is_empty() {
                name.clone()
            } else {
                format!("{node}/{name}")
            },
            name,
            directory: meta.is_dir(),
            size: meta.len(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|time| time.as_millis())
                .unwrap_or(0),
        });
    }
    nodes.sort_by(|a, b| {
        let extension = |item: &Node| {
            item.name
                .rsplit_once('.')
                .filter(|(stem, _)| !stem.is_empty())
                .map(|(_, ext)| ext.to_lowercase())
                .unwrap_or_default()
        };
        b.directory
            .cmp(&a.directory)
            .then_with(|| {
                if matches!(options.sort, FileSort::Type | FileSort::TypeDesc) && !a.directory {
                    if matches!(options.sort, FileSort::TypeDesc) {
                        extension(b).cmp(&extension(a))
                    } else {
                        extension(a).cmp(&extension(b))
                    }
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .then_with(|| {
                if a.directory {
                    return std::cmp::Ordering::Equal;
                }
                match options.sort {
                    FileSort::Size => a.size.cmp(&b.size),
                    FileSort::SizeDesc => b.size.cmp(&a.size),
                    FileSort::Modified => a.modified_ms.cmp(&b.modified_ms),
                    FileSort::ModifiedDesc => b.modified_ms.cmp(&a.modified_ms),
                    _ => std::cmp::Ordering::Equal,
                }
            })
            .then_with(|| {
                if matches!(options.sort, FileSort::NameDesc) {
                    b.name.cmp(&a.name)
                } else {
                    a.name.cmp(&b.name)
                }
            })
    });
    let next = if offset.saturating_add(200) < nodes.len() {
        Some(offset + 200)
    } else {
        None
    };
    Ok(Page {
        nodes: nodes.into_iter().skip(offset).take(200).collect(),
        next,
    })
}
#[cfg(test)]
fn list(root: &Path, node: &str, offset: usize) -> Result<Page, String> {
    list_with_options(root, node, offset, &ListOptions::default())
}
#[tauri::command]
pub async fn local_files_list(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    offset: usize,
    options: Option<ListOptions>,
) -> Result<Page, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let page = tauri::async_runtime::spawn_blocking(move || {
        list_with_options(&root, &node, offset, &options.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())??;
    library.root(&root_id)?;
    Ok(page)
}
fn read(root: &Path, node: &str) -> Result<Snapshot, String> {
    if node.is_empty() {
        return Err("请选择文件".into());
    }
    let path = checked_path(root, node)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err("只读源码入口最多打开 4 MiB 普通文件".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("文件超过 4 MiB".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "仅支持 UTF-8 文本文件")?;
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\x0b' | '\x0c'))
    {
        return Err("这是二进制或不支持的文本文件".into());
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if bom { &bytes[3..] } else { &bytes[..] };
    let decoded = std::str::from_utf8(content).map_err(|_| "仅支持 UTF-8 文本文件")?;
    let without_crlf = decoded.replace("\r\n", "");
    let kinds = usize::from(decoded.contains("\r\n"))
        + usize::from(without_crlf.contains('\n'))
        + usize::from(without_crlf.contains('\r'));
    let line_ending = if kinds > 1 {
        "mixed"
    } else if decoded.contains("\r\n") {
        "crlf"
    } else if decoded.contains('\r') {
        "cr"
    } else {
        "lf"
    };
    let source = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    Ok(Snapshot {
        source,
        revision: format!("{:x}", Sha256::digest(&bytes)),
        bom,
        line_ending: line_ending.into(),
        modified_ms,
        size: meta.len(),
    })
}
fn stat(root: &Path, node: &str) -> Result<Fingerprint, String> {
    let path = checked_path(root, node)?;
    let meta = fs::metadata(path).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("节点不是普通文件".into());
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    Ok(Fingerprint {
        modified_ms,
        size: meta.len(),
    })
}
#[tauri::command]
pub async fn local_files_stat(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<Fingerprint, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || stat(&root, &node))
        .await
        .map_err(|error| error.to_string())??;
    library.root(&root_id)?;
    Ok(result)
}
#[tauri::command]
pub async fn local_files_read(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<Snapshot, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read(&root, &node))
        .await
        .map_err(|e| e.to_string())??;
    library.root(&root_id)?;
    Ok(bytes)
}

fn write(
    root: &Path,
    node: &str,
    source: &str,
    expected_revision: &str,
    bom: bool,
    line_ending: &str,
    authorization: (Arc<Mutex<HashMap<String, PathBuf>>>, String),
) -> Result<Snapshot, String> {
    let (roots, root_id) = authorization;
    if source.len() as u64 > MAX_BYTES {
        return Err("文件超过 4 MiB".into());
    }
    if source
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
    {
        return Err("文本包含不支持的控制字符".into());
    }
    if line_ending == "mixed" {
        return Err("文件包含混合换行符；为避免静默改写格式，请使用另存为副本".into());
    }
    if !matches!(line_ending, "lf" | "crlf" | "cr") {
        return Err("换行格式无效".into());
    }
    let target = checked_path(root, node)?;
    let current = fs::read(&target).map_err(|error| error.to_string())?;
    let actual_revision = format!("{:x}", Sha256::digest(&current));
    if actual_revision != expected_revision {
        return Err("STALE_REVISION: 磁盘文件已被外部修改".into());
    }
    let target_permissions = fs::metadata(&target)
        .map_err(|error| error.to_string())?
        .permissions();
    if target_permissions.readonly() {
        return Err("文件为只读权限，无法保存".into());
    }
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let encoded = match line_ending {
        "crlf" => normalized.replace('\n', "\r\n"),
        "cr" => normalized.replace('\n', "\r"),
        _ => normalized,
    };
    let mut bytes = Vec::with_capacity(encoded.len() + usize::from(bom) * 3);
    if bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(encoded.as_bytes());
    if bytes.len() as u64 > MAX_BYTES {
        return Err("按原换行格式编码后文件超过 4 MiB".into());
    }
    let parent = target.parent().ok_or("文件路径无效")?;
    let temp = parent.join(format!(".nr-save-{}.tmp", uuid::Uuid::new_v4()));
    let result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::set_permissions(&temp, target_permissions.clone())
            .map_err(|error| error.to_string())?;
        // Revalidate the authorized root immediately before replacing the file.
        if checked_path(root, node)? != target {
            return Err("授权路径在保存期间发生变化".into());
        }
        let latest = fs::read(&target).map_err(|error| error.to_string())?;
        if format!("{:x}", Sha256::digest(&latest)) != expected_revision {
            return Err("STALE_REVISION: 磁盘文件在保存期间被外部修改".into());
        }
        // Keep revocation from racing the final replacement. If the grant was
        // removed while the temporary file was being prepared, abort instead.
        let grants = roots.lock().map_err(|_| "目录状态不可用")?;
        if grants.get(&root_id).map(PathBuf::as_path) != Some(root) {
            return Err("目录授权已撤销，未写入文件".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe {
                MoveFileExW(
                    windows::core::PCWSTR(from.as_ptr()),
                    windows::core::PCWSTR(to.as_ptr()),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            }
            .map_err(|error| error.to_string())?;
        }
        #[cfg(not(windows))]
        fs::rename(&temp, &target).map_err(|error| error.to_string())?;
        drop(grants);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    read(root, node)
}

// Keep the established IPC fields flat; two arguments are injected Tauri context.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn local_files_write(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    source: String,
    expected_revision: String,
    bom: bool,
    line_ending: String,
) -> Result<Snapshot, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let roots = library.roots.clone();
    let write_root_id = root_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        write(
            &root,
            &node,
            &source,
            &expected_revision,
            bom,
            &line_ending,
            (roots, write_root_id),
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    library.root(&root_id)?;
    Ok(result)
}

fn read_asset_range(
    root: &Path,
    node: &str,
    offset: u64,
    length: Option<usize>,
) -> Result<Vec<u8>, String> {
    let path = checked_path(root, node)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "svg"
            | "avif"
            | "bmp"
            | "ico"
            | "tif"
            | "tiff"
            | "heic"
            | "heif"
            | "pdf"
    ) {
        return Err("仅允许预览常见图片或 PDF 文件".into());
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let meta = file.metadata().map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("不是普通预览文件".into());
    }
    if extension == "pdf" && meta.len() > 32 * 1024 * 1024 {
        return Err("PDF 快速预览最多 32 MiB".into());
    }
    if length.is_some_and(|length| length == 0 || length > 1024 * 1024) {
        return Err("预览读取分段无效".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(length.map(|v| v as u64).unwrap_or(u64::MAX))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}
#[tauri::command]
pub async fn local_files_read_asset(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
    offset: Option<u64>,
    length: Option<usize>,
) -> Result<tauri::ipc::Response, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_asset_range(&root, &node, offset.unwrap_or(0), length)
    })
    .await
    .map_err(|error| error.to_string())??;
    library.root(&root_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn local_files_save_as(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    source: String,
    bom: bool,
    line_ending: String,
) -> Result<bool, String> {
    caller(&window)?;
    if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', ':', '\0']) {
        return Err("文件名无效".into());
    }
    if source.len() as u64 > MAX_BYTES {
        return Err("文件超过 4 MiB".into());
    }
    if source
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err("文本包含不支持的控制字符".into());
    }
    let eol = if matches!(line_ending.as_str(), "lf" | "crlf" | "cr") {
        line_ending
    } else {
        "lf".into()
    };
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let text = match eol.as_str() {
        "crlf" => normalized.replace('\n', "\r\n"),
        "cr" => normalized.replace('\n', "\r"),
        _ => normalized,
    };
    let mut bytes = Vec::with_capacity(text.len() + usize::from(bom) * 3);
    if bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(text.as_bytes());
    if bytes.len() as u64 > MAX_BYTES {
        return Err("另存后文件超过 4 MiB".into());
    }
    let dialog = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let Some(chosen) = dialog
            .dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let selected = chosen.into_path().map_err(|error| error.to_string())?;
        let parent = fs::canonicalize(selected.parent().ok_or("保存路径无效")?)
            .map_err(|error| error.to_string())?;
        let target = parent.join(selected.file_name().ok_or("保存路径无效")?);
        if let Ok(meta) = fs::symlink_metadata(&target) {
            if is_link(&meta) || !meta.is_file() {
                return Err("目标不是普通文件，拒绝覆盖".into());
            }
        }
        let temp = parent.join(format!(".nr-save-as-{}.tmp", uuid::Uuid::new_v4()));
        let result: Result<(), String> = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|error| error.to_string())?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                use windows::Win32::Storage::FileSystem::{
                    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
                };
                let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
                unsafe {
                    MoveFileExW(
                        windows::core::PCWSTR(from.as_ptr()),
                        windows::core::PCWSTR(to.as_ptr()),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                }
                .map_err(|error| error.to_string())?;
            }
            #[cfg(not(windows))]
            fs::rename(&temp, &target).map_err(|error| error.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_parent_and_child_revocation_preserves_files_and_other_grants() {
        let fixture = TransferFixture::new();
        let child = fixture.0.join("child");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("leaf.txt"), "kept").unwrap();
        let library = LocalFiles::load(&fixture.0);
        {
            let mut roots = library.roots.lock().unwrap();
            roots.insert("parent".into(), fixture.0.clone());
            roots.insert("child".into(), child.clone());
        }
        library.persist().unwrap();
        library.revoke_root("child").unwrap();
        assert!(library.root("child").is_err());
        assert_eq!(
            fs::read_to_string(
                checked_path(&library.root("parent").unwrap(), "child/leaf.txt").unwrap()
            )
            .unwrap(),
            "kept"
        );
        assert!(LocalFiles::load(&fixture.0).root("child").is_err());
        library
            .roots
            .lock()
            .unwrap()
            .insert("child-two".into(), child.clone());
        library.revoke_root("parent").unwrap();
        let restored = LocalFiles::load(&fixture.0);
        assert!(restored.root("parent").is_err());
        assert_eq!(restored.root("child-two").unwrap(), child);
        assert!(restored
            .root("child-two")
            .unwrap()
            .join("leaf.txt")
            .is_file());
    }
    #[test]
    fn failed_revocation_keeps_the_live_grant() {
        let mut library = LocalFiles::default();
        library
            .roots
            .lock()
            .unwrap()
            .insert("r".into(), std::env::temp_dir());
        assert!(library.revoke_root("r").is_err());
        assert!(library.root("r").is_ok());
        let fixture = TransferFixture::new();
        library.grants_path = Some(fixture.0.clone()); // Writing a file over a directory must fail.
        assert!(library.revoke_root("r").is_err());
        assert!(library.root("r").is_ok());
    }
    struct TransferFixture(PathBuf);
    impl TransferFixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("nr-cross-move-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            fs::create_dir(root.join("dest")).unwrap();
            Self(root)
        }
        fn source(&self) -> PathBuf {
            self.0.join("source")
        }
        fn target(&self) -> PathBuf {
            self.0.join("dest/target")
        }
        fn copy(&self, source: &Path, target: &Path) -> Result<(), String> {
            copy_tree(source, target, 0, &mut 10000)
        }
        fn rename(&self, source: &Path, target: &Path) -> std::io::Result<()> {
            if source == self.source() {
                Err(std::io::ErrorKind::CrossesDevices.into())
            } else {
                move_exclusive(source, target)
            }
        }
        fn retire(&self, source: &Path) -> Result<(), String> {
            fs::rename(source, self.0.join("recovered-source")).map_err(|e| e.to_string())
        }
    }
    impl Drop for TransferFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn type_sorting_supports_both_directions_without_moving_directories() {
        let area = TransferFixture::new();
        for name in ["a.c", "z.c", "a.txt"] {
            fs::write(area.0.join(name), "test").unwrap();
        }
        for (sort, expected) in [
            ("type", vec!["dest", "a.c", "z.c", "a.txt"]),
            ("type-desc", vec!["dest", "a.txt", "a.c", "z.c"]),
        ] {
            let options: ListOptions =
                serde_json::from_value(serde_json::json!({ "sort": sort })).unwrap();
            let page = list_with_options(&area.0, "", 0, &options).unwrap();
            assert_eq!(
                page.nodes
                    .iter()
                    .map(|node| node.name.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }
    #[test]
    fn directory_metadata_uses_the_frontend_wire_contract() {
        let area = TransferFixture::new();
        let page = list_with_options(&area.0, "", 0, &ListOptions::default()).unwrap();
        let serialized = serde_json::to_value(&page).unwrap();
        let directory = serialized["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["name"] == "dest")
            .unwrap();
        assert_eq!(directory["directory"], true);
        assert!(directory["modifiedMs"].as_u64().unwrap() > 0);
        assert!(directory.get("modified_ms").is_none());
    }
    #[test]
    fn external_open_is_scoped_and_never_launches_links_or_directories() {
        let area = TransferFixture::new();
        fs::write(area.source(), "example").unwrap();
        assert_eq!(external_target(&area.0, "source").unwrap(), area.source());
        for node in ["", "..", "../outside", "dest", "/source", "source/.."] {
            assert!(external_target(&area.0, node).is_err(), "{node}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(area.source(), area.0.join("link")).unwrap();
            assert!(external_target(&area.0, "link").is_err());
        }
    }
    #[test]
    fn grant_storage_is_host_owned_and_isolated() {
        let area = TransferFixture::new();
        let first = LocalFiles::load(&area.0);
        first
            .roots
            .lock()
            .unwrap()
            .insert("one".into(), area.source());
        first.persist().unwrap();
        let second = LocalFiles::load(&area.0.join("dest"));
        assert!(second.root("one").is_err());
        second
            .roots
            .lock()
            .unwrap()
            .insert("two".into(), area.target());
        second.persist().unwrap();
        assert_eq!(
            LocalFiles::load(&area.0).root("one").unwrap(),
            area.source()
        );
        assert!(LocalFiles::load(&area.0).root("two").is_err());
        assert_eq!(
            LocalFiles::load(&area.0.join("dest")).root("two").unwrap(),
            area.target()
        );
        assert!(LocalFiles::default()
            .persist()
            .unwrap_err()
            .contains("尚未初始化"));
    }
    #[test]
    fn cross_move_verifies_hidden_binary_and_empty_directories_before_retiring_source() {
        let area = TransferFixture::new();
        fs::create_dir(area.source()).unwrap();
        fs::create_dir(area.source().join("empty")).unwrap();
        fs::write(area.source().join(".binary"), [0, 255, 5, 0]).unwrap();
        fs::write(area.0.join("dest/.nine-rings-copy-keep"), "other operation").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(area.source(), fs::Permissions::from_mode(0o700)).unwrap();
        }
        super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |from, to| area.copy(from, to),
            |path| {
                assert_eq!(
                    fs::read(area.target().join(".binary")).unwrap(),
                    [0, 255, 5, 0]
                );
                assert!(area.target().join("empty").is_dir());
                area.retire(path)
            },
        )
        .unwrap();
        assert!(!area.source().exists());
        assert_eq!(
            fs::read(area.0.join("recovered-source/.binary")).unwrap(),
            [0, 255, 5, 0]
        );
        assert_eq!(
            fs::read_to_string(area.0.join("dest/.nine-rings-copy-keep")).unwrap(),
            "other operation"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(area.target()).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 2);
    }
    #[test]
    fn same_device_move_and_other_errors_never_use_cross_device_fallback() {
        let area = TransferFixture::new();
        fs::write(area.source(), "keep").unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || panic!("unexpected validation"),
            move_exclusive,
            |_, _| panic!("unexpected copy"),
            |_| panic!("unexpected retire"),
        );
        result.unwrap();
        assert_eq!(fs::read_to_string(area.target()).unwrap(), "keep");
        fs::write(area.source(), "source").unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || panic!("unexpected validation"),
            |_, _| Err(std::io::ErrorKind::PermissionDenied.into()),
            |_, _| panic!("unexpected copy"),
            |_| panic!("unexpected retire"),
        );
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(area.source()).unwrap(), "source");
        #[cfg(unix)]
        assert_eq!(
            std::io::Error::from_raw_os_error(libc::EXDEV).kind(),
            std::io::ErrorKind::CrossesDevices
        );
        #[cfg(windows)]
        assert_eq!(
            std::io::Error::from_raw_os_error(17).kind(),
            std::io::ErrorKind::CrossesDevices
        );
    }
    #[test]
    fn cross_move_rejects_same_size_content_changes_even_when_modified_time_is_restored() {
        let area = TransferFixture::new();
        fs::write(area.source(), "old").unwrap();
        let modified = fs::metadata(area.source()).unwrap().modified().unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |from, to| {
                area.copy(from, to)?;
                fs::write(from, "new").unwrap();
                fs::OpenOptions::new()
                    .write(true)
                    .open(from)
                    .unwrap()
                    .set_times(fs::FileTimes::new().set_modified(modified))
                    .unwrap();
                Ok(())
            },
            |_| panic!("changed source must not be retired"),
        );
        assert!(result.unwrap_err().contains("来源内容"));
        assert!(!area.target().exists());
        assert_eq!(fs::read_to_string(area.source()).unwrap(), "new");
        assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 0);
    }
    #[test]
    fn cross_move_rejects_corruption_and_partial_copy_without_retiring_source() {
        for partial in [false, true] {
            let area = TransferFixture::new();
            fs::write(area.source(), "source").unwrap();
            let result = super::super::local_file_transfer::move_with_fallback(
                &area.source(),
                &area.target(),
                || Ok(()),
                |from, to| area.rename(from, to),
                |from, to| {
                    area.copy(from, to)?;
                    fs::write(to, "broken").unwrap();
                    if partial {
                        Err("simulated interruption".into())
                    } else {
                        Ok(())
                    }
                },
                |_| panic!("unverified copy must not retire source"),
            );
            assert!(result.is_err());
            assert!(!area.target().exists());
            assert_eq!(fs::read_to_string(area.source()).unwrap(), "source");
            assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 0);
        }
    }
    #[test]
    fn cross_move_publication_conflict_never_overwrites_or_retires_source() {
        let area = TransferFixture::new();
        fs::write(area.source(), "source").unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| {
                if from != area.source() {
                    fs::write(to, "external").unwrap();
                }
                area.rename(from, to)
            },
            |from, to| area.copy(from, to),
            |_| panic!("conflicting target must preserve source"),
        );
        assert!(result.unwrap_err().contains("TARGET_EXISTS"));
        assert_eq!(fs::read_to_string(area.target()).unwrap(), "external");
        assert_eq!(fs::read_to_string(area.source()).unwrap(), "source");
    }
    #[test]
    fn cross_move_post_publication_changes_preserve_both_sides_and_never_retire_source() {
        for change_source in [false, true] {
            let area = TransferFixture::new();
            fs::write(area.source(), "source").unwrap();
            let result = super::super::local_file_transfer::move_with_fallback(
                &area.source(),
                &area.target(),
                || Ok(()),
                |from, to| {
                    area.rename(from, to)?;
                    fs::write(
                        if change_source {
                            area.source()
                        } else {
                            area.target()
                        },
                        "external",
                    )
                    .unwrap();
                    Ok(())
                },
                |from, to| area.copy(from, to),
                |_| panic!("post-publication changes must preserve source"),
            );
            assert!(result.unwrap_err().starts_with("MOVE_COPY_PUBLISHED:"));
            assert!(area.source().exists() && area.target().exists());
            assert_eq!(
                fs::read_to_string(if change_source {
                    area.source()
                } else {
                    area.target()
                })
                .unwrap(),
                "external"
            );
        }
    }
    #[test]
    fn cross_move_retirement_failure_keeps_verified_target_and_source_for_review() {
        let area = TransferFixture::new();
        fs::write(area.source(), "source").unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |from, to| area.copy(from, to),
            |_| Err("TARGET_EXISTS: simulated trash failure".into()),
        );
        assert!(result.unwrap_err().starts_with("MOVE_COPY_PUBLISHED:"));
        assert_eq!(
            fs::read(area.source()).unwrap(),
            fs::read(area.target()).unwrap()
        );
        assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 1);
    }
    #[test]
    fn cross_move_binary_files_are_not_limited_by_the_text_editor_budget() {
        let area = TransferFixture::new();
        let bytes: Vec<u8> = (0..MAX_BYTES + 4096)
            .map(|index| (index % 251) as u8)
            .collect();
        fs::write(area.source(), &bytes).unwrap();
        super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |from, to| area.copy(from, to),
            |path| area.retire(path),
        )
        .unwrap();
        assert_eq!(fs::read(area.target()).unwrap(), bytes);
        assert!(!area.source().exists());
        assert_eq!(
            fs::metadata(area.0.join("recovered-source")).unwrap().len(),
            MAX_BYTES + 4096
        );
    }
    #[test]
    fn cross_move_checks_depth_budget_before_creating_a_final_target() {
        let area = TransferFixture::new();
        fs::create_dir(area.source()).unwrap();
        let mut folder = area.source();
        for _ in 0..65 {
            folder = folder.join("d");
            fs::create_dir(&folder).unwrap();
        }
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |_, _| panic!("invalid tree must not be copied"),
            |_| panic!("invalid tree must not be retired"),
        );
        assert!(result.unwrap_err().contains("预算"));
        assert!(area.source().exists());
        assert!(!area.target().exists());
        assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 0);
    }
    #[test]
    fn transfer_rechecks_access_before_copy_publication() {
        let area = TransferFixture::new();
        fs::write(area.source(), "source").unwrap();
        let calls = std::cell::Cell::new(0);
        let result = guarded_transfer_entry(
            &area.0,
            "source",
            &area.0.join("dest"),
            "",
            "target",
            false,
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    Err("目录授权已变化".into())
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.unwrap_err().contains("目录授权已变化"));
        assert_eq!(calls.get(), 2);
        assert!(!area.target().exists());
        assert_eq!(fs::read_to_string(area.source()).unwrap(), "source");
        assert_eq!(fs::read_dir(area.0.join("dest")).unwrap().count(), 0);
    }
    #[test]
    fn cross_move_revalidates_grants_before_publication_and_before_source_retirement() {
        for fail_at in [2, 3, 4] {
            let area = TransferFixture::new();
            fs::write(area.source(), "source").unwrap();
            let calls = std::cell::Cell::new(0);
            let result = super::super::local_file_transfer::move_with_fallback(
                &area.source(),
                &area.target(),
                || {
                    calls.set(calls.get() + 1);
                    if calls.get() == fail_at {
                        Err("grant changed".into())
                    } else {
                        Ok(())
                    }
                },
                |from, to| area.rename(from, to),
                |from, to| area.copy(from, to),
                |_| panic!("invalid grants must preserve source"),
            );
            let error = result.unwrap_err();
            assert_eq!(error.starts_with("MOVE_COPY_PUBLISHED:"), fail_at > 2);
            assert_eq!(area.target().exists(), fail_at > 2);
            assert_eq!(fs::read_to_string(area.source()).unwrap(), "source");
        }
    }
    #[cfg(unix)]
    #[test]
    fn cross_move_rejects_links_without_touching_external_contents() {
        let area = TransferFixture::new();
        fs::create_dir(area.source()).unwrap();
        fs::write(area.0.join("outside"), "keep").unwrap();
        std::os::unix::fs::symlink(area.0.join("outside"), area.source().join("link")).unwrap();
        let result = super::super::local_file_transfer::move_with_fallback(
            &area.source(),
            &area.target(),
            || Ok(()),
            |from, to| area.rename(from, to),
            |from, to| area.copy(from, to),
            |_| panic!("link must not be retired"),
        );
        assert!(result.is_err());
        assert!(!area.target().exists());
        assert_eq!(fs::read_to_string(area.0.join("outside")).unwrap(), "keep");
    }
    #[test]
    fn metadata_order_is_applied_to_the_whole_directory_before_paging() {
        let dir = std::env::temp_dir().join(format!("nr-file-sort-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dir = fs::canonicalize(dir).unwrap();
        for i in 0..205 {
            fs::write(dir.join(format!("item-{i:03}")), vec![0; i + 1]).unwrap();
        }
        let options: ListOptions =
            serde_json::from_str(r#"{"sort":"size-desc","showHidden":true,"query":""}"#).unwrap();
        let page = list_with_options(&dir, "", 0, &options).unwrap();
        assert_eq!(page.nodes[0].name, "item-204");
        assert_eq!(page.next, Some(200));
        let tail = list_with_options(&dir, "", 200, &options).unwrap();
        assert_eq!(tail.nodes[4].name, "item-000");
        let options: ListOptions = serde_json::from_str(r#"{"sort":"modified-desc"}"#).unwrap();
        let page = list_with_options(&dir, "", 0, &options).unwrap();
        assert!(page
            .nodes
            .windows(2)
            .all(|pair| pair[0].modified_ms >= pair[1].modified_ms));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn create_and_move_are_scoped_and_never_replace_existing_entries() {
        let dir = std::env::temp_dir().join(format!("nr-file-ops-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dir = fs::canonicalize(dir).unwrap();
        assert_eq!(create_entry(&dir, "", "src", true).unwrap(), "src");
        create_entry(&dir, "", "dest", true).unwrap();
        create_entry(&dir, "src", "file.c", false).unwrap();
        fs::write(dir.join("src/file.c"), "preserve").unwrap();
        assert!(create_entry(&dir, "src", "file.c", false).is_err());
        assert!(create_entry(&dir, "", "../escape", false).is_err());
        assert!(move_entry(&dir, "src", "src", "nested").is_err());
        assert!(move_entry(&dir, "", "dest", "root").is_err());
        assert!(move_entry(&dir, "src/file.c", "../", "escape").is_err());
        assert_eq!(
            move_entry(&dir, "src/file.c", "dest", "file.c").unwrap(),
            "dest/file.c"
        );
        assert!(!dir.join("src/file.c").exists());
        assert_eq!(
            fs::read_to_string(dir.join("dest/file.c")).unwrap(),
            "preserve"
        );
        create_entry(&dir, "src", "file.c", false).unwrap();
        assert!(move_entry(&dir, "src/file.c", "dest", "file.c").is_err());
        assert_eq!(
            fs::read_to_string(dir.join("dest/file.c")).unwrap(),
            "preserve"
        );
        create_entry(&dir, "src", "nested", true).unwrap();
        assert!(move_entry(&dir, "src", "src/nested", "cycle").is_err());
        assert_eq!(
            move_entry(&dir, "src", "dest", "moved").unwrap(),
            "dest/moved"
        );
        assert!(dir.join("dest/moved/nested").is_dir());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("dest"), dir.join("link")).unwrap();
            assert!(create_entry(&dir, "link", "escape", false).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn scope_paging_and_text_limits() {
        let dir = std::env::temp_dir().join(format!("nr-files-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dir = fs::canonicalize(dir).unwrap();
        fs::write(dir.join("sample.c"), "int main() {}\r\n").unwrap();
        fs::write(dir.join("binary"), [0u8, 1]).unwrap();
        for i in 0..205 {
            fs::write(dir.join(format!("item{i}")), "").unwrap();
        }
        assert_eq!(list(&dir, "", 0).unwrap().nodes.len(), 200);
        assert_eq!(list(&dir, "", 0).unwrap().next, Some(200));
        let snapshot = read(&dir, "sample.c").unwrap();
        assert_eq!(snapshot.source, "int main() {}\n");
        assert_eq!(snapshot.line_ending, "crlf");
        assert_eq!(snapshot.revision.len(), 64);
        assert!(read(&dir, "binary").is_err());
        assert!(checked_path(&dir, "../secret").is_err());
        assert!(checked_path(&dir, "/etc/passwd").is_err());
        assert!(checked_path(&dir, "a\\b").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("sample.c"), dir.join("link")).unwrap();
            assert!(read(&dir, "link").is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn transfer_between_grants_is_exclusive_and_preserves_binary_contents() {
        let dir = std::env::temp_dir().join(format!("nr-transfer-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dir = fs::canonicalize(dir).unwrap();
        let left = dir.join("left");
        let right = dir.join("right");
        fs::create_dir(&left).unwrap();
        fs::create_dir(&right).unwrap();
        fs::create_dir(left.join("nested")).unwrap();
        fs::write(left.join("nested/data.bin"), [0, 255, 1, 0]).unwrap();
        transfer_entry(&left, "nested", &right, "", "copy", false).unwrap();
        assert_eq!(
            fs::read(right.join("copy/data.bin")).unwrap(),
            [0, 255, 1, 0]
        );
        assert!(left.join("nested/data.bin").exists());
        assert!(transfer_entry(&left, "nested", &right, "", "copy", false)
            .unwrap_err()
            .contains("TARGET_EXISTS"));
        assert!(transfer_entry(&left, "nested", &left, "nested", "cycle", false).is_err());
        assert!(transfer_entry(&left, "nested", &right, "../left", "escape", false).is_err());
        assert!(transfer_entry(&left, "", &right, "", "root", true).is_err());
        transfer_entry(&left, "nested", &right, "", "moved", true).unwrap();
        assert!(!left.join("nested").exists());
        assert!(right.join("moved/data.bin").exists());
        assert!(!fs::read_dir(&right).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".nine-rings-copy-")));
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn transfer_rejects_nested_links_and_cleans_only_its_staging_directory() {
        let dir = std::env::temp_dir().join(format!("nr-transfer-link-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dir = fs::canonicalize(dir).unwrap();
        fs::create_dir(dir.join("src")).unwrap();
        fs::create_dir(dir.join("dest")).unwrap();
        fs::write(dir.join("outside"), "keep").unwrap();
        std::os::unix::fs::symlink(dir.join("outside"), dir.join("src/link")).unwrap();
        assert!(transfer_entry(&dir, "src", &dir, "dest", "copy", false).is_err());
        assert!(!dir.join("dest/copy").exists());
        assert_eq!(fs::read_to_string(dir.join("outside")).unwrap(), "keep");
        assert_eq!(fs::read_dir(dir.join("dest")).unwrap().count(), 0);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod preview_properties_tests {
    use super::*;
    #[test]
    fn large_image_ranges_and_properties_remain_scoped() {
        let temp =
            std::env::temp_dir().join(format!("nr-image-properties-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&temp).unwrap();
        let root = fs::canonicalize(&temp).unwrap();
        let mut file = fs::File::create(root.join("large.png")).unwrap();
        let size = 80 * 1024 * 1024;
        file.set_len(size).unwrap();
        file.seek(SeekFrom::Start(size - 3)).unwrap();
        file.write_all(&[1, 2, 3]).unwrap();
        drop(file);
        assert_eq!(
            read_asset_range(&root, "large.png", size - 3, Some(3)).unwrap(),
            vec![1, 2, 3]
        );
        assert!(read_asset_range(&root, "large.png", 0, Some(2 * 1024 * 1024)).is_err());
        assert!(read_asset_range(&root, "../large.png", 0, Some(3)).is_err());
        fs::write(root.join("document.pdf"), b"%PDF-test").unwrap();
        assert_eq!(
            read_asset_range(&root, "document.pdf", 0, Some(5)).unwrap(),
            b"%PDF-"
        );
        fs::File::create(root.join("large.pdf"))
            .unwrap()
            .set_len(33 * 1024 * 1024)
            .unwrap();
        assert!(read_asset_range(&root, "large.pdf", 0, Some(3)).is_err());
        fs::write(root.join("blocked.bin"), b"not a preview").unwrap();
        assert!(read_asset_range(&root, "blocked.bin", 0, Some(3)).is_err());
        let (_, details) = file_properties(&root, "large.png").unwrap();
        assert_eq!(details["size"], size);
        assert_eq!(details["directory"], false);
        assert!(details["modifiedMs"].is_number());
        assert!(details["permissions"].is_string());
        assert!(file_properties(&root, "../escape").is_err());
        assert_eq!(file_properties(&root, "").unwrap().1["directory"], true);
        fs::remove_dir_all(root).unwrap();
    }
}
