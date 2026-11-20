//! Coordinate a clean editor handoff around an exclusive native move.
use super::*;
use std::sync::mpsc;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RelocationRequest {
    id: String,
    token: u64,
    target_node: String,
}
pub(super) struct PendingRelocation {
    label: String,
    token: u64,
    reply: mpsc::SyncSender<Result<String, String>>,
}
#[tauri::command]
pub async fn workbench_move_open_file(
    window: tauri::WebviewWindow,
    root_id: String,
    node: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    crate::main_window(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        relocate_open_file(&app, &root_id, &node, &parent, &name)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| {
        if error.starts_with("MOVE_RELOCATION_PUBLISHED:") {
            error
        } else {
            format!("MOVE_RELOCATION_NOT_WRITTEN: {error}")
        }
    })
}

#[tauri::command]
pub fn workbench_editor_relocation_reply(
    window: tauri::WebviewWindow,
    token: u64,
    revision: Option<String>,
    reason: Option<String>,
) -> Result<(), String> {
    editor(&window)?;
    let owner = window.state::<EditorWindows>();
    let mut pending = owner.5.lock().map_err(|_| "编辑器迁移状态不可用")?;
    if pending
        .as_ref()
        .is_some_and(|value| value.label == window.label() && value.token == token)
    {
        let request = pending.take().unwrap();
        let _ = request.reply.try_send(
            revision.ok_or_else(|| reason.unwrap_or_else(|| "此标签暂时无法移动".into())),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn workbench_editor_relocation_preferences_done(
    window: tauri::WebviewWindow,
    id: String,
    from: String,
) -> Result<(), String> {
    editor(&window)?;
    let owner = window.state::<EditorWindows>();
    let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
    let mut next = state.clone();
    let Some(file) = next
        .files
        .iter_mut()
        .find(|item| item.id == id && item.file["relocatedFrom"] == from)
    else {
        return Ok(());
    };
    if let Some(descriptor) = file.file.as_object_mut() {
        descriptor.remove("relocatedFrom");
    }
    next.persist(window.app_handle())?;
    next.revision += 1;
    *state = next;
    drop(state);
    changed(window.app_handle());
    Ok(())
}

fn relocate_open_file(
    app: &tauri::AppHandle,
    root_id: &str,
    node: &str,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    let library = app.state::<local_files::LocalFiles>();
    let (source, target, target_node) =
        library.editor_relocation_paths(root_id, node, parent, name)?;
    let editor = window(app).ok_or("来源标签已关闭，请重试普通移动")?;
    let (old_id, new_id) = (
        source.to_str().ok_or("来源文件路径无法编码")?,
        target.to_str().ok_or("目标文件路径无法编码")?,
    );
    let access = app.state::<FileWindowAccess>();
    let lease = access.begin_editor_relocation(editor.label(), &source, &target)?;
    let stamp = library.editor_relocation_stamp(root_id, node, &source)?;
    let owner = app.state::<EditorWindows>();
    let _restore = owner.4.lock().map_err(|_| "编辑器恢复状态不可用")?;
    let (reply, receive) = mpsc::sync_channel(1);
    let (token, journal) = {
        let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
        if !state.ready || state.closing.is_some() || state.relocation.is_some() {
            return Err("编辑器正在加载、关闭或移动标签，请稍后重试".into());
        }
        let mut destination = state
            .files
            .iter()
            .find(|file| {
                file.id == old_id
                    && file.file["bufferId"].is_null()
                    && file.file["rootId"] == root_id
                    && file.file["node"]["id"] == node
            })
            .cloned()
            .ok_or("请从打开该文件时使用的目录授权移动普通文件")?;
        let from = format!("{root_id}:{node}");
        let session_key = destination.file["sessionKey"]
            .as_str()
            .unwrap_or(old_id)
            .to_owned();
        destination.id = new_id.to_owned();
        destination.file["node"]["id"] = json!(target_node);
        destination.file["node"]["name"] = json!(name);
        destination.file["location"] = Value::Null;
        destination.file["sessionKey"] = json!(session_key);
        destination.file["relocatedFrom"] = json!(from);
        let journal = crate::editor_session::Relocation {
            source: old_id.to_owned(),
            target: destination,
            stamp,
        };
        let token = state.revision + 1;
        *owner.5.lock().map_err(|_| "编辑器迁移状态不可用")? = Some(PendingRelocation {
            label: editor.label().to_owned(),
            token,
            reply,
        });
        state.revision = token;
        state.relocation = Some(RelocationRequest {
            id: old_id.to_owned(),
            token,
            target_node: target_node.clone(),
        });
        (token, journal)
    };
    changed(app);

    let result = (|| {
        let acknowledged = receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "编辑器未能确认暂停写入，文件保持原位")??;
        if acknowledged != journal.stamp.digest {
            return Err("磁盘版本与打开的标签不同，请先刷新文件".into());
        }
        let mut state = owner.0.lock().map_err(|_| "编辑器状态不可用")?;
        if !state
            .relocation
            .as_ref()
            .is_some_and(|value| value.token == token)
        {
            return Err("编辑器迁移请求已失效".into());
        }
        let store = app.state::<crate::editor_session::EditorSessionStore>();
        store.prepare_relocation(&state.files, state.current.as_deref(), journal.clone())?;
        let result = lease.publish_editor_relocation(editor.label(), &source, &target, || {
            library.publish_editor_relocation(
                root_id,
                node,
                &target_node,
                &source,
                &target,
                &journal.stamp,
            )
        });
        if let Err(error) = result {
            return match state.persist(app) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!("{error}；迁移记录将在重启后核对（{cleanup}）")),
            };
        }
        let mut next = state.clone();
        journal.apply(&mut next.files, &mut next.current);
        let sync = local_files::sync_relocation_paths(&source, &target);
        next.unsynced_move = if sync.is_err() {
            Some((source.clone(), target.clone()))
        } else {
            None
        };
        let persisted = sync.and_then(|()| next.persist(app));
        // The file moved and the native reservation follows its new path even
        // if final session publication failed. Startup replays the prepared record.
        *state = next;
        persisted.map_err(|error| {
            format!("MOVE_RELOCATION_PUBLISHED: 文件已移动，标签记录将在重启后核对（{error}）")
        })?;
        Ok(target_node)
    })();
    drop(lease);
    if let Ok(mut state) = owner.0.lock() {
        if state
            .relocation
            .as_ref()
            .is_some_and(|value| value.token == token)
        {
            state.relocation = None;
            state.revision += 1;
        }
    }
    if let Ok(mut pending) = owner.5.lock() {
        if pending.as_ref().is_some_and(|value| value.token == token) {
            *pending = None;
        }
    }
    changed(app);
    result
}
