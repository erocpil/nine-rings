pub mod relocation;
use nine_rings_file_host::{local_files, window_access::FileWindowAccess};
use relocation::{PendingRelocation, RelocationRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    from: usize,
    to: usize,
    revision: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    pub id: String,
    pub file: Value,
    pub open_revision: u64,
}
#[derive(Clone, Serialize)]
pub struct Close {
    token: u64,
    quit: bool,
    #[serde(skip)]
    confirmed: Vec<String>,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    files: Vec<EditorFile>,
    current: Option<String>,
    revision: u64,
    closing: Option<Close>,
    relocation: Option<RelocationRequest>,
    #[serde(skip)]
    ready: bool,
    #[serde(skip)]
    unsynced_move: Option<(std::path::PathBuf, std::path::PathBuf)>,
}
#[derive(Default)]
pub struct EditorWindows(
    Mutex<Session>,
    Mutex<()>,
    Mutex<Option<String>>,
    AtomicU64,
    Mutex<()>,
    Mutex<Option<PendingRelocation>>,
);
impl Session {
    fn clear(&mut self) {
        let revision = self.revision + 1;
        *self = Self {
            revision,
            ..Self::default()
        };
    }
    fn open(&mut self, mut file: EditorFile) -> Result<(), String> {
        if self.closing.is_some() {
            return Err("编辑器正在确认关闭，请先完成或取消".into());
        }
        if let Some(existing) = self.files.iter_mut().find(|item| item.id == file.id) {
            existing.file["location"] = file.file["location"].clone();
            existing.file["headingFragment"] = file.file["headingFragment"].clone();
            existing.open_revision += 1;
        } else {
            if self.files.len() >= 32 {
                return Err("编辑器最多同时保留32个文件，请先关闭部分标签".into());
            }
            if self
                .files
                .iter()
                .any(|existing| existing.file["sessionKey"] == file.id)
            {
                file.file["sessionKey"] = json!(format!("{}\0{}", file.id, self.revision));
            }
            self.files.push(file.clone());
        }
        self.current = Some(file.id);
        self.revision += 1;
        Ok(())
    }
    fn finish(&mut self, token: u64, cancelled: bool) -> Result<Option<bool>, String> {
        let close = self
            .closing
            .clone()
            .filter(|close| close.token == token)
            .ok_or("关闭请求已过期")?;
        if cancelled {
            self.closing = None;
            self.revision += 1;
            return Ok(None);
        }
        if self
            .files
            .iter()
            .any(|file| !close.confirmed.contains(&file.id))
        {
            return Err("仍有未确认的编辑文件".into());
        }
        Ok(Some(close.quit))
    }
    fn confirm_file(&mut self, token: u64, id: &str) -> Result<(), String> {
        if !self.files.iter().any(|file| file.id == id) {
            return Err("文件会话已关闭".into());
        }
        let close = self
            .closing
            .as_mut()
            .filter(|close| close.token == token)
            .ok_or("关闭请求已过期")?;
        if !close.confirmed.iter().any(|value| value == id) {
            close.confirmed.push(id.to_owned());
        }
        Ok(())
    }
    fn persist(&self, app: &tauri::AppHandle) -> Result<(), String> {
        if let Some((source, target)) = &self.unsynced_move {
            local_files::sync_relocation_paths(source, target)?;
        }
        app.state::<super::editor_session::EditorSessionStore>()
            .save(&self.files, self.current.as_deref())
    }
    fn close(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .files
            .iter()
            .position(|file| file.id == id)
            .ok_or("文件会话已关闭")?;
        self.files.remove(index);
        if self.current.as_deref() == Some(id) {
            self.current = self
                .files
                .get(index.min(self.files.len().saturating_sub(1)))
                .map(|file| file.id.clone());
        }
        self.revision += 1;
        Ok(())
    }
}
pub fn editor(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" && window.state::<FileWindowAccess>().allows(window.label()) {
        Ok(())
    } else {
        Err("仅可信编辑器窗口可调用".into())
    }
}
pub fn window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let state = app.state::<EditorWindows>();
    let label = state.2.lock().ok()?.clone()?;
    app.get_webview_window(&label)
}
fn publish_presence(app: &tauri::AppHandle) {
    let owner = app.state::<EditorWindows>();
    if let Ok(state) = owner.0.lock() {
        let revision = state.revision;
        drop(state);
        let _ = app.emit_to(
            "main",
            "workbench:editor-presence",
            json!({ "present": window(app).is_some(), "revision": revision }),
        );
    };
}
#[tauri::command]
pub fn workbench_editor_presence(window: tauri::WebviewWindow) -> Result<Value, String> {
    super::main_window(&window)?;
    let revision = window
        .state::<EditorWindows>()
        .0
        .lock()
        .map_err(|_| "编辑器状态不可用")?
        .revision;
    Ok(json!({ "present": self::window(window.app_handle()).is_some(), "revision": revision }))
}
pub fn changed(app: &tauri::AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.emit("workbench:editor-changed", ());
    }
}
#[tauri::command]
pub fn workbench_window_role(window: tauri::WebviewWindow) -> Result<&'static str, String> {
    if window.label() == "main" {
        Ok("browser")
    } else {
        editor(&window)?;
        Ok("editor")
    }
}
#[tauri::command]
pub async fn open_pdf_print_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    title: String,
    html: String,
) -> Result<(), String> {
    editor(&window)?;
    nine_rings_file_host::pdf_print::open_pdf_print_preview(app, title, html)
}

#[tauri::command]
pub async fn print_pdf_document(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<(), String> {
    nine_rings_file_host::pdf_print::print_pdf_document(window, title).await
}

#[tauri::command]
pub async fn save_rendered_html(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    html: String,
) -> Result<bool, String> {
    editor(&window)?;
    nine_rings_file_host::pdf_print::save_rendered_html(app, window, name, html).await
}

#[tauri::command]
pub async fn workbench_open_editor(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    root_id: String,
    node: String,
    location: Option<Location>,
    heading_fragment: Option<String>,
) -> Result<(), String> {
    // Tauri documents WebView2 deadlocks for synchronous window creation.
    tauri::async_runtime::spawn_blocking(move || {
        open_editor(window, app, root_id, node, location, heading_fragment)
    })
    .await
    .map_err(|error| error.to_string())?
}
fn open_editor(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    root_id: String,
    node: String,
    location: Option<Location>,
    heading_fragment: Option<String>,
) -> Result<(), String> {
    super::main_window(&window)?;
    if let Some(location) = &location {
        if location.from > location.to || location.revision.len() > 256 {
            return Err("无效的文件定位".into());
        }
    }
    if heading_fragment
        .as_ref()
        .is_some_and(|fragment| fragment.is_empty() || fragment.encode_utf16().count() > 4096)
    {
        return Err("无效的标题或锚点".into());
    }
    let mut file = disk_editor_file(window, &app, root_id, node, location)?;
    file.file["headingFragment"] = json!(heading_fragment);
    publish_file(&app, file, true)
}

#[tauri::command]
pub async fn workbench_follow_editor_link(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    source_id: String,
    root_id: String,
    node: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        editor(&window)?;
        if !std::path::Path::new(&node)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
            })
        {
            return Err("文档内跳转需要 Markdown 文件".into());
        }
        let owner = app.state::<EditorWindows>();
        let _restore = owner.4.lock().map_err(|_| "编辑器恢复状态不可用")?;
        let source = {
            let state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
            state
                .files
                .iter()
                .find(|file| {
                    file.id == source_id && state.current.as_deref() == Some(source_id.as_str())
                })
                .cloned()
                .ok_or("来源文件已切换，请重新打开链接")?
        };
        let (root, _) =
            editor_link_origin(&app, &source)?.ok_or("当前文件没有可用于跳转的授权目录")?;
        if root != root_id {
            return Err("来源授权目录已变化，请重新打开链接".into());
        }
        let file = disk_editor_file(window, &app, root, node, None)?;
        publish_restored_file(&app, file, true, Some(&source_id))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn editor_link_origin(
    app: &tauri::AppHandle,
    source: &EditorFile,
) -> Result<Option<(String, String)>, String> {
    if !source.file["bufferId"].is_null() {
        return match source.file["bufferPath"].as_str() {
            Some(path) => app
                .state::<local_files::LocalFiles>()
                .authorized_document_origin(std::path::Path::new(path)),
            None => Ok(None),
        };
    }
    Ok(source.file["rootId"]
        .as_str()
        .zip(source.file["node"]["id"].as_str())
        .map(|(root, node)| (root.to_owned(), node.to_owned())))
}

#[tauri::command]
pub fn workbench_editor_link_origin(
    window: tauri::WebviewWindow,
    source_id: String,
) -> Result<Option<Value>, String> {
    editor(&window)?;
    let source = {
        let owner = window.state::<EditorWindows>();
        let state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
        state
            .files
            .iter()
            .find(|file| file.id == source_id)
            .cloned()
    };
    let Some(source) = source else {
        return Ok(None);
    };
    Ok(editor_link_origin(window.app_handle(), &source)?
        .map(|(root_id, node)| json!({ "rootId": root_id, "node": node })))
}

fn disk_editor_file(
    window: tauri::WebviewWindow,
    app: &tauri::AppHandle,
    root_id: String,
    node: String,
    location: Option<Location>,
) -> Result<EditorFile, String> {
    let path = local_files::local_files_display_path(
        window,
        app.state::<local_files::LocalFiles>(),
        root_id.clone(),
        node.clone(),
    )?;
    let meta = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("只能在编辑器中打开文件".into());
    }
    let filename = std::path::Path::new(&path)
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .to_string();
    Ok(EditorFile {
        id: path,
        open_revision: 1,
        file: json!({ "rootId": root_id, "rootName": "本地文件", "node": { "id": node, "name": filename, "directory": false, "size": meta.len(), "modifiedMs": meta.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_millis()) }, "location": location }),
    })
}

pub(crate) fn open_native_path(
    app: &tauri::AppHandle,
    normalized: &std::path::Path,
    root_id: String,
    node: String,
) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("文件浏览窗口不可用")?;
    let file = disk_editor_file(main, app, root_id, node, None)?;
    if std::path::Path::new(&file.id) != normalized {
        return Err("目录授权已变化，请重新打开文件".into());
    }
    publish_file(app, file, true)
}

pub fn publish_file(app: &tauri::AppHandle, file: EditorFile, protect: bool) -> Result<(), String> {
    let owner = app.state::<EditorWindows>();
    let _restore = owner.4.lock().map_err(|_| "编辑器恢复状态不可用")?;
    if app
        .state::<super::editor_session::EditorSessionStore>()
        .restoring
        .load(Ordering::SeqCst)
    {
        return Err("编辑器正在恢复标签，请稍后重试".into());
    }
    if window(app).is_none() {
        restore_locked(app)?;
    }
    publish_restored_file(app, file, protect, None).map(|_| ())
}
fn publish_restored_file(
    app: &tauri::AppHandle,
    mut file: EditorFile,
    protect: bool,
    source_id: Option<&str>,
) -> Result<String, String> {
    let owner = app.state::<EditorWindows>();
    let _creation = owner.1.lock().map_err(|_| "编辑器创建状态不可用")?;
    // A document first saved from a buffer keeps its identity and undo history.
    // Reopening its disk path must activate that same session, never a second writer.
    if file.file["bufferId"].is_null() {
        if app.state::<super::buffers::BufferDocuments>().is_saving()? {
            return Err("新建文档正在保存，请完成保存后再打开磁盘文件".into());
        }
        let state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
        if let Some(existing) = state.files.iter().find(|item| {
            item.file["bufferPath"]
                .as_str()
                .is_some_and(|path| path == file.id)
        }) {
            let location = file.file["location"].clone();
            let heading_fragment = file.file["headingFragment"].clone();
            file = existing.clone();
            file.file["location"] = location;
            file.file["headingFragment"] = heading_fragment;
        }
    }
    // The creation mutex serializes publication while WebView construction runs off the UI thread.
    let access = app.state::<FileWindowAccess>();
    let existing = self::window(app);
    let label = existing
        .as_ref()
        .map(|window| window.label().to_string())
        .unwrap_or_else(|| {
            format!(
                "workbench-editor-{}",
                owner.3.fetch_add(1, Ordering::SeqCst) + 1
            )
        });
    if existing.is_none() {
        access.grant_editor(&label)?;
    }
    struct PendingGrant<'a>(Option<&'a FileWindowAccess>, &'a str);
    impl Drop for PendingGrant<'_> {
        fn drop(&mut self) {
            if let Some(access) = self.0 {
                access.revoke_editor(self.1);
            }
        }
    }
    let mut grant = PendingGrant(
        if existing.is_none() {
            Some(&access)
        } else {
            None
        },
        &label,
    );
    let state = app.state::<EditorWindows>();
    if existing.is_none() {
        let mut value = state.0.lock().map_err(|_| "编辑器状态不可用")?;
        value.clear();
        drop(value);
        *state.2.lock().map_err(|_| "编辑器窗口状态不可用")? = Some(label.clone());
    }
    let protected_path =
        std::path::Path::new(file.file["bufferPath"].as_str().unwrap_or(&file.id)).to_owned();
    let new_path = protect && access.protect_editor_path(&label, &protected_path)?;
    let opened_id = file.id.clone();
    let opened = (|| {
        let mut state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
        if source_id.is_some_and(|id| state.current.as_deref() != Some(id)) {
            return Err("来源文件已切换，请重新打开链接".into());
        }
        let mut next = state.clone();
        next.open(file)?;
        next.persist(app)?;
        *state = next;
        Ok::<_, String>(())
    })();
    if let Err(error) = opened {
        if new_path {
            access.release_editor_path(&label, &protected_path);
        }
        if existing.is_none() {
            access.revoke_editor(&label);
        }
        return Err(error);
    }
    let target = if let Some(existing) = existing {
        existing
    } else {
        match tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App("file-workbench.html".into()),
        )
        .title("File Workbench — Editor")
        .visible(false)
        .inner_size(1100., 800.)
        .min_inner_size(600., 400.)
        .disable_drag_drop_handler()
        .build()
        {
            Ok(window) => window,
            Err(error) => {
                access.revoke_editor(&label);
                state.0.lock().map_err(|_| "编辑器状态不可用")?.clear();
                *state.2.lock().map_err(|_| "编辑器窗口状态不可用")? = None;
                publish_presence(app);
                return Err(error.to_string());
            }
        }
    };
    grant.0 = None;
    publish_presence(app);
    changed(app);
    if source_id.is_none() {
        target.unminimize().map_err(|e| e.to_string())?;
        target.show().map_err(|e| e.to_string())?;
        target.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(opened_id)
}

pub(crate) fn reserve_buffer_save(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<super::buffers::Saving, String> {
    let owner = app.state::<EditorWindows>();
    let _publication = owner.1.lock().map_err(|_| "编辑器创建状态不可用")?;
    app.state::<super::buffers::BufferDocuments>()
        .begin_save(id)
}
pub fn update_buffer(app: &tauri::AppHandle, file: EditorFile) -> Result<(), String> {
    let owner = app.state::<EditorWindows>();
    let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
    let current = state
        .files
        .iter_mut()
        .find(|item| item.id == file.id)
        .ok_or("编辑文档标签已关闭")?;
    // The committed buffer record supplies file metadata on restore. The
    // manifest already keeps its identity, order and selection.
    current.file = file.file;
    state.revision += 1;
    drop(state);
    changed(app);
    Ok(())
}
pub fn path_is_open(
    app: &tauri::AppHandle,
    path: &std::path::Path,
    except: &str,
) -> Result<bool, String> {
    let owner = app.state::<EditorWindows>();
    let state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
    Ok(state.files.iter().any(|item| {
        item.id != except
            && (std::path::Path::new(&item.id) == path
                || item.file["bufferPath"]
                    .as_str()
                    .is_some_and(|value| std::path::Path::new(value) == path))
    }))
}

#[tauri::command]
pub fn workbench_editor_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EditorWindows>,
) -> Result<Session, String> {
    editor(&window)?;
    let mut state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    state.ready = true;
    Ok(state.clone())
}
#[tauri::command]
pub fn workbench_editor_select(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    editor(&window)?;
    let state = window.state::<EditorWindows>();
    let mut state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    if state.closing.is_some() || !state.files.iter().any(|file| file.id == id) {
        return Err("文件会话已变化，请重试".into());
    }
    let mut next = state.clone();
    next.current = Some(id);
    next.revision += 1;
    next.persist(window.app_handle())?;
    *state = next;
    drop(state);
    changed(window.app_handle());
    Ok(())
}
#[tauri::command]
pub fn workbench_editor_remove(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    remove_file(window, id, false)
}
pub(crate) fn discard_buffer(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    remove_file(window, id, true)
}
fn remove_file(window: tauri::WebviewWindow, id: String, discard: bool) -> Result<(), String> {
    editor(&window)?;
    let state = window.state::<EditorWindows>();
    let mut value = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    if value.closing.is_some() || value.relocation.is_some() {
        return Err("编辑器正在确认关闭或移动标签，请等待完成".into());
    }
    let buffer = value
        .files
        .iter()
        .find(|item| item.id == id)
        .and_then(|item| item.file["bufferId"].as_str())
        .map(str::to_owned);
    let protected = value
        .files
        .iter()
        .find(|item| item.id == id)
        .and_then(|item| item.file["bufferPath"].as_str())
        .unwrap_or(&id)
        .to_owned();
    let mut next = value.clone();
    next.close(&id)?;
    next.persist(window.app_handle())?;
    if let Some(buffer) = buffer {
        let documents = window.state::<super::buffers::BufferDocuments>();
        let result = if discard {
            documents.discard(&buffer)
        } else {
            documents.close(&buffer)
        };
        if let Err(error) = result {
            value
                .persist(window.app_handle())
                .map_err(|rollback| format!("{error}；标签记录回滚失败：{rollback}"))?;
            return Err(error);
        }
    }
    *value = next;

    window
        .state::<FileWindowAccess>()
        .release_editor_path(window.label(), std::path::Path::new(&protected));
    if value.files.is_empty() && value.closing.is_none() {
        value.revision += 1;
        value.closing = Some(Close {
            token: value.revision,
            quit: false,
            confirmed: Vec::new(),
        });
    }
    drop(value);
    changed(window.app_handle());
    Ok(())
}
#[tauri::command]
pub fn workbench_show_browser(
    window: tauri::WebviewWindow,
    id: Option<String>,
) -> Result<(), String> {
    editor(&window)?;
    if let Some(id) = id {
        let state = window.state::<EditorWindows>();
        let state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
        let file = state
            .files
            .iter()
            .find(|file| file.id == id)
            .ok_or("文件会话已关闭")?;
        window
            .emit_to(
                "main",
                "workbench:reveal-file",
                json!({ "rootId": file.file["rootId"], "node": file.file["node"]["id"] }),
            )
            .map_err(|e| e.to_string())?;
    }
    super::show_workbench(window.app_handle());
    Ok(())
}
#[tauri::command]
pub async fn workbench_show_editor(window: tauri::WebviewWindow) -> Result<(), String> {
    super::main_window(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if self::window(&app).is_none() {
            restore(&app)?;
        }
        let editor = self::window(&app).ok_or("尚未打开独立编辑器；可通过 File → New File 新建")?;
        editor.unminimize().map_err(|e| e.to_string())?;
        editor.show().map_err(|e| e.to_string())?;
        editor.set_focus().map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn workbench_editor_saved(
    window: tauri::WebviewWindow,
    root_id: String,
    node: String,
) -> Result<(), String> {
    editor(&window)?;
    let state = window.state::<EditorWindows>();
    if !state
        .0
        .lock()
        .map_err(|_| "编辑器状态不可用")?
        .files
        .iter()
        .any(|file| file.file["rootId"] == root_id && file.file["node"]["id"] == node)
    {
        return Err("文件会话不存在".into());
    }
    window
        .emit_to(
            "main",
            "workbench:files-changed",
            json!({ "kind": "refresh", "rootId": root_id, "node": node }),
        )
        .map_err(|e| e.to_string())
}
pub fn request_close(app: &tauri::AppHandle, quit: bool) -> Result<(), String> {
    let state = app.state::<EditorWindows>();
    let mut state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    if !state.ready {
        drop(state);
        if let Some(window) = self::window(app) {
            window.destroy().map_err(|error| error.to_string())?;
        }
        if quit && app.state::<super::ClosePolicy>().confirm() {
            app.exit(0);
        }
        return Ok(());
    }
    if state.relocation.is_some() {
        return Err("文件移动尚未完成，请稍后关闭编辑器".into());
    }
    if state.closing.is_some() {
        return Ok(());
    }
    state.revision += 1;
    state.closing = Some(Close {
        token: state.revision,
        quit,
        confirmed: Vec::new(),
    });
    drop(state);
    changed(app);
    if let Some(window) = self::window(app) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}
#[tauri::command]
pub fn workbench_editor_confirm_file(
    window: tauri::WebviewWindow,
    token: u64,
    id: String,
) -> Result<(), String> {
    editor(&window)?;
    let owner = window.state::<EditorWindows>();
    let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
    state.confirm_file(token, &id)
}
pub fn restore(app: &tauri::AppHandle) -> Result<(), String> {
    let owner = app.state::<EditorWindows>();
    let _restore = owner.4.lock().map_err(|_| "编辑器恢复状态不可用")?;
    restore_locked(app)
}
fn restore_locked(app: &tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<super::editor_session::EditorSessionStore>();
    struct RestoreGuard<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for RestoreGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _restoring = RestoreGuard(&store.restoring);
    let saved = match store.read()? {
        Some(saved) => saved,
        None => {
            let files = app
                .state::<super::buffers::BufferDocuments>()
                .list()?
                .into_iter()
                .map(|record| record.session())
                .collect::<Vec<_>>();
            let current = files.last().map(|file| file.id.clone());
            store.initialize(&files, current.as_deref())?;
            super::editor_session::Snapshot {
                version: 1,
                files,
                current,
                relocation: None,
            }
        }
    };
    store.restoring.store(true, Ordering::SeqCst);
    let result = (|| {
        for mut file in saved.files {
            if let Some(id) = file.file["bufferId"].as_str() {
                let Ok(record) = app.state::<super::buffers::BufferDocuments>().get(id) else {
                    // Invalid draft records are reported by the loader and left
                    // intact. Continue restoring the remaining tabs.
                    continue;
                };
                file = record.session();
            }
            let protect = file.file["bufferId"].is_null() || file.file["bufferPath"].is_string();
            publish_restored_file(app, file, protect, None)?;
        }
        let owner = app.state::<EditorWindows>();
        let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
        if let Some(id) = saved
            .current
            .filter(|id| state.files.iter().any(|file| &file.id == id))
        {
            state.current = Some(id);
            state.revision += 1;
        }
        drop(state);
        changed(app);
        Ok(())
    })();
    store.restoring.store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub fn workbench_editor_finish_close(
    window: tauri::WebviewWindow,
    token: u64,
    cancelled: bool,
) -> Result<(), String> {
    editor(&window)?;
    let app = window.app_handle().clone();
    let state = app.state::<EditorWindows>();
    let mut state = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    let Some(quit) = state.finish(token, cancelled)? else {
        drop(state);
        changed(&app);
        return Ok(());
    };
    if quit && app.state::<super::tools::ToolJobs>().active() {
        state.closing = None;
        state.revision += 1;
        drop(state);
        changed(&app);
        return Err("命令行工具仍在运行，请稍后退出".into());
    }
    drop(state);
    window.destroy().map_err(|e| e.to_string())?;
    if quit && app.state::<super::ClosePolicy>().confirm() {
        app.exit(0);
    }
    Ok(())
}
#[tauri::command]
pub fn workbench_editor_request_quit(window: tauri::WebviewWindow) -> Result<(), String> {
    editor(&window)?;
    window
        .emit_to("main", "workbench:request-close", ())
        .map_err(|e| e.to_string())
}
pub fn destroyed(app: &tauri::AppHandle, label: &str) {
    app.state::<FileWindowAccess>().revoke_editor(label);
    let owner = app.state::<EditorWindows>();
    if let Ok(mut current) = owner.2.lock() {
        if current.as_deref() != Some(label) {
            return;
        }
        *current = None;
        if let Ok(mut state) = owner.0.lock() {
            state.clear();
        }
    };
    publish_presence(app);
}
#[cfg(test)]
mod tests {
    use super::*;
    fn file(id: &str) -> EditorFile {
        EditorFile {
            id: id.into(),
            file: json!({ "node": { "name": id } }),
            open_revision: 1,
        }
    }
    #[test]
    fn duplicate_open_preserves_session_order_and_close_selects_a_neighbor() {
        let mut state = Session::default();
        state.open(file("a")).unwrap();
        state.open(file("b")).unwrap();
        state.open(file("a")).unwrap();
        assert_eq!(state.files.len(), 2);
        assert_eq!(state.files[0].id, "a");
        assert_eq!(state.files[0].open_revision, 2);
        state.close("a").unwrap();
        assert_eq!(state.current.as_deref(), Some("b"));
        assert!(state.close("a").is_err());
    }
    #[test]
    fn duplicate_open_updates_the_transient_heading_destination() {
        let mut state = Session::default();
        state.open(file("a")).unwrap();
        let mut targeted = file("a");
        targeted.file["headingFragment"] = json!("目标章节");
        state.open(targeted).unwrap();
        assert_eq!(state.files[0].open_revision, 2);
        assert_eq!(state.files[0].file["headingFragment"], "目标章节");
        state.open(file("a")).unwrap();
        assert!(state.files[0].file["headingFragment"].is_null());
    }
    #[test]
    fn closing_and_capacity_do_not_admit_new_sessions() {
        let mut state = Session::default();
        for index in 0..32 {
            state.open(file(&index.to_string())).unwrap();
        }
        assert!(state.open(file("extra")).is_err());
        state.open(file("0")).unwrap();
        state.closing = Some(Close {
            token: 3,
            quit: false,
            confirmed: Vec::new(),
        });
        assert!(state.open(file("0")).is_err());
    }
    #[test]
    fn close_confirmation_rejects_stale_tokens_and_remaining_files_and_cancel_keeps_sessions() {
        let mut state = Session::default();
        state.open(file("a")).unwrap();
        state.closing = Some(Close {
            token: 5,
            quit: true,
            confirmed: Vec::new(),
        });
        assert!(state.finish(4, true).is_err());
        assert!(state.finish(5, false).is_err());
        assert_eq!(state.finish(5, true).unwrap(), None);
        assert_eq!(state.files.len(), 1);
        assert!(state.closing.is_none());
        assert!(state.finish(5, false).is_err());
        state.closing = Some(Close {
            token: 6,
            quit: true,
            confirmed: Vec::new(),
        });
        state.close("a").unwrap();
        assert_eq!(state.finish(6, false).unwrap(), Some(true));
    }
    #[test]
    fn window_close_confirms_contents_without_closing_tabs_and_rejects_stale_acknowledgements() {
        let mut state = Session::default();
        state.open(file("a")).unwrap();
        state.open(file("b")).unwrap();
        state.closing = Some(Close {
            token: 12,
            quit: true,
            confirmed: Vec::new(),
        });
        assert!(state.confirm_file(11, "a").is_err());
        assert!(state.confirm_file(12, "missing").is_err());
        state.confirm_file(12, "a").unwrap();
        state.confirm_file(12, "a").unwrap();
        assert!(state.finish(12, false).is_err());
        state.confirm_file(12, "b").unwrap();
        assert_eq!(state.finish(12, false).unwrap(), Some(true));
        assert_eq!(state.files.len(), 2);
        assert_eq!(state.current.as_deref(), Some("b"));
        state.finish(12, true).unwrap();
        assert!(state.closing.is_none());
        assert_eq!(state.files.len(), 2);
    }
    #[test]
    fn failed_or_destroyed_windows_clear_sessions_without_rewinding_presence_versions() {
        let mut state = Session::default();
        state.open(file("a")).unwrap();
        state.ready = true;
        let before = state.revision;
        state.clear();
        assert!(state.revision > before);
        assert!(state.files.is_empty());
        assert!(state.current.is_none());
        assert!(!state.ready);
        let cleared = state.revision;
        state.open(file("b")).unwrap();
        assert!(state.revision > cleared);
    }
}
