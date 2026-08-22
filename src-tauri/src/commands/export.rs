use crate::commands::config::{self, AppConfig};
use crate::{AppState, DataDir};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub notes: usize,
    pub daily_pages: usize,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub notes_imported: usize,
    pub pages_imported: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configs_imported: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteOldInput {
    /// 删除多少天前的已删除笔记（默认 30）
    pub older_than_days: Option<i64>,
}

fn is_sensitive_config_key(key: &str) -> bool {
    key.to_lowercase().contains("token")
}

fn sanitize_config_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sanitized = serde_json::Map::new();
            for (key, value) in map {
                if is_sensitive_config_key(&key) {
                    continue;
                }
                sanitized.insert(key, sanitize_config_value(value));
            }
            Value::Object(sanitized)
        }
        Value::Array(values) => {
            Value::Array(values.into_iter().map(sanitize_config_value).collect())
        }
        other => other,
    }
}

#[tauri::command]
pub fn export_data(
    state: State<AppState>,
    config_state: State<'_, Mutex<AppConfig>>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let app_config = config_state.lock().map_err(|e| e.to_string())?.clone();
    let mut bundle = crate::export::export_all(&conn, &app_config).map_err(|e| e.to_string())?;
    bundle.config = bundle.config.map(sanitize_config_value);
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data(
    state: State<AppState>,
    config_state: State<'_, Mutex<AppConfig>>,
    data_dir: State<'_, DataDir>,
    json: String,
) -> Result<ImportResult, String> {
    let bundle: crate::export::ExportBundle =
        serde_json::from_str(&json).map_err(|e| format!("parse error: {}", e))?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (n, p) = crate::export::import_bundle(&conn, &bundle).map_err(|e| e.to_string())?;
    let mut configs_imported = None;
    if let Some(raw_config) = bundle.config {
        let sanitized = sanitize_config_value(raw_config);
        if let Value::Object(partial) = sanitized {
            config::set_config(config_state, data_dir, Value::Object(partial))?;
            configs_imported = Some(1);
        }
    }
    Ok(ImportResult {
        notes_imported: n,
        pages_imported: p,
        configs_imported,
    })
}

// ──── 回收站 ────

#[tauri::command]
pub fn get_deleted_notes(state: State<AppState>) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
             FROM notes WHERE deleted_at IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], crate::db::models::note_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notes SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn permanently_delete_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clean_old_deleted(state: State<AppState>, older_than_days: i64) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(older_than_days)).to_rfc3339();
    let deleted = conn
        .execute(
            "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            rusqlite::params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted)
}

// ──── 原生对话框导出/导入（Tauri 桌面端专用）────

#[tauri::command]
pub fn export_to_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn import_from_file(
    state: State<AppState>,
    config_state: State<'_, Mutex<AppConfig>>,
    data_dir: State<'_, DataDir>,
    path: String,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))?;
    import_data(state, config_state, data_dir, content)
}

#[tauri::command]
pub fn export_note_markdown(state: State<AppState>, note_id: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let note = crate::db::models::select_note_by_id(&conn, &note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "note not found".to_string())?;
    Ok(crate::export::note_to_markdown(&note))
}
