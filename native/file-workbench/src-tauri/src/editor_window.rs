use nine_rings_file_host::{local_files, window_access::FileWindowAccess};
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
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    id: String,
    file: Value,
    open_revision: u64,
}
#[derive(Clone, Serialize)]
pub struct Close {
    token: u64,
    quit: bool,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    files: Vec<EditorFile>,
    current: Option<String>,
    revision: u64,
    closing: Option<Close>,
    #[serde(skip)]
    ready: bool,
}
#[derive(Default)]
pub struct EditorWindows(Mutex<Session>, Mutex<()>, Mutex<Option<String>>, AtomicU64);
impl Session {
    fn clear(&mut self) {
        let revision = self.revision + 1;
        *self = Self {
            revision,
            ..Self::default()
        };
    }
    fn open(&mut self, file: EditorFile) -> Result<(), String> {
        if self.closing.is_some() {
            return Err("编辑器正在确认关闭，请先完成或取消".into());
        }
        if let Some(existing) = self.files.iter_mut().find(|item| item.id == file.id) {
            existing.file["location"] = file.file["location"].clone();
            existing.open_revision += 1;
        } else {
            if self.files.len() >= 32 {
                return Err("编辑器最多同时保留32个文件，请先关闭部分标签".into());
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
        if !self.files.is_empty() {
            return Err("仍有未确认的编辑文件".into());
        }
        Ok(Some(close.quit))
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
fn editor(window: &tauri::WebviewWindow) -> Result<(), String> {
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
fn changed(app: &tauri::AppHandle) {
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
pub async fn workbench_open_editor(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    root_id: String,
    node: String,
    location: Option<Location>,
) -> Result<(), String> {
    // Tauri documents WebView2 deadlocks for synchronous window creation.
    tauri::async_runtime::spawn_blocking(move || open_editor(window, app, root_id, node, location))
        .await
        .map_err(|error| error.to_string())?
}
fn open_editor(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    root_id: String,
    node: String,
    location: Option<Location>,
) -> Result<(), String> {
    super::main_window(&window)?;
    let owner = app.state::<EditorWindows>();
    let _creation = owner.1.lock().map_err(|_| "编辑器创建状态不可用")?;
    if let Some(location) = &location {
        if location.from > location.to || location.revision.len() > 256 {
            return Err("无效的文件定位".into());
        }
    }
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
    let file = EditorFile {
        id: path,
        open_revision: 1,
        file: json!({ "rootId": root_id, "rootName": "本地文件", "node": { "id": node, "name": filename, "directory": false, "size": meta.len(), "modifiedMs": meta.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_millis()) }, "location": location }),
    };
    // The creation mutex serializes publication while WebView construction runs off the UI thread.
    let access = app.state::<FileWindowAccess>();
    let existing = self::window(&app);
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
    if let Err(error) = state.0.lock().map_err(|_| "编辑器状态不可用")?.open(file) {
        if existing.is_none() {
            access.revoke_editor(&label);
        }
        return Err(error);
    }
    let target = if let Some(existing) = existing {
        existing
    } else {
        match tauri::WebviewWindowBuilder::new(
            &app,
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
                publish_presence(&app);
                return Err(error.to_string());
            }
        }
    };
    grant.0 = None;
    publish_presence(&app);
    changed(&app);
    target.unminimize().map_err(|e| e.to_string())?;
    target.show().map_err(|e| e.to_string())?;
    target.set_focus().map_err(|e| e.to_string())
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
    state.current = Some(id);
    state.revision += 1;
    drop(state);
    changed(window.app_handle());
    Ok(())
}
#[tauri::command]
pub fn workbench_editor_remove(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    editor(&window)?;
    let state = window.state::<EditorWindows>();
    let mut value = state.0.lock().map_err(|_| "编辑器状态不可用")?;
    value.close(&id)?;
    if value.files.is_empty() && value.closing.is_none() {
        value.revision += 1;
        value.closing = Some(Close {
            token: value.revision,
            quit: false,
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
pub fn workbench_show_editor(window: tauri::WebviewWindow) -> Result<(), String> {
    super::main_window(&window)?;
    let editor = self::window(window.app_handle()).ok_or("尚未打开独立编辑器")?;
    editor.unminimize().map_err(|e| e.to_string())?;
    editor.show().map_err(|e| e.to_string())?;
    editor.set_focus().map_err(|e| e.to_string())
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
    if state.closing.is_some() {
        return Ok(());
    }
    state.revision += 1;
    state.closing = Some(Close {
        token: state.revision,
        quit,
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
        });
        state.close("a").unwrap();
        assert_eq!(state.finish(6, false).unwrap(), Some(true));
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
