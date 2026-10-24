//! Scoped local-file grants. Deliberately independent of image grants and document storage.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
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
#[derive(Default)]
pub struct LocalFiles {
    roots: Arc<Mutex<HashMap<String, PathBuf>>>,
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
pub struct Node {
    id: String,
    name: String,
    directory: bool,
    size: u64,
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
    fn save(&self, app: &tauri::AppHandle) -> Result<(), String> {
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
            app.state::<crate::DataDir>()
                .0
                .join("local-file-roots.json"),
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
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
) -> Result<(), String> {
    caller(&window)?;
    library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .remove(&root_id);
    library.save(&app)
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
fn move_exclusive(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let from =
            std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to =
            std::ffi::CString::new(target.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
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
        return Err("当前平台不支持安全移动".into());
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if result != 0 {
            return Err(std::io::Error::last_os_error().to_string());
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
        .map_err(|e| e.to_string())?;
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
    move_exclusive(&source, &target)?;
    Ok(if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    })
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
    move_exclusive(&source, &target)?;
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
                if matches!(options.sort, FileSort::Type) && !a.directory {
                    extension(a).cmp(&extension(b))
                } else {
                    std::cmp::Ordering::Equal
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
    roots: Arc<Mutex<HashMap<String, PathBuf>>>,
    root_id: String,
) -> Result<Snapshot, String> {
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
            roots,
            write_root_id,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    library.root(&root_id)?;
    Ok(result)
}

fn read_asset(root: &Path, node: &str) -> Result<Vec<u8>, String> {
    let path = checked_path(root, node)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif"
    ) {
        return Err("仅允许预览常见图片文件".into());
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let meta = file.metadata().map_err(|error| error.to_string())?;
    if !meta.is_file() || meta.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20 MiB 或不是普通文件".into());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(20 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20 MiB".into());
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn local_files_read_asset(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    root_id: String,
    node: String,
) -> Result<tauri::ipc::Response, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_asset(&root, &node))
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
}
