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
    replace: Option<bool>,
) -> Result<ImportResult, String> {
    let bundle: crate::export::ExportBundle =
        serde_json::from_str(&json).map_err(|e| format!("parse error: {}", e))?;
    if bundle.version != 1 && bundle.version != 2 {
        return Err("不支持的备份版本".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut current = config_state.lock().map_err(|e| e.to_string())?;
    let mut next = serde_json::to_value(&*current).map_err(|e| e.to_string())?;
    let configs_imported =
        if let Some(Value::Object(partial)) = bundle.config.clone().map(sanitize_config_value) {
            for (key, value) in partial {
                if !value.is_null() {
                    next[&key] = value;
                }
            }
            Some(1)
        } else {
            None
        };
    let merged: AppConfig = serde_json::from_value(next).map_err(|e| e.to_string())?;
    if configs_imported.is_some() {
        config::write_config(&data_dir.0, &merged)?;
    }
    let (n, p) = match crate::export::import_bundle(&conn, &bundle, replace.unwrap_or(false)) {
        Ok(result) => result,
        Err(error) => {
            if configs_imported.is_some() {
                config::write_config(&data_dir.0, &current)
                    .map_err(|rollback| format!("导入失败: {error}; 配置恢复失败: {rollback}"))?;
            }
            return Err(error.to_string());
        }
    };
    *current = merged;
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
    permanently_delete_trashed_note(&conn, &id)
}

fn permanently_delete_trashed_note(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let restored: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notes WHERE id = ?1 AND deleted_at IS NULL)",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if restored {
        return Err("文档已恢复，不能从回收站永久删除；请刷新列表".into());
    }
    tx.execute(
        "DELETE FROM note_versions WHERE note_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod recycle_tests {
    use super::permanently_delete_trashed_note;
    use rusqlite::Connection;

    #[test]
    fn permanent_delete_preserves_restored_notes_and_their_versions() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, deleted_at TEXT);
             CREATE TABLE note_versions (id TEXT PRIMARY KEY, note_id TEXT);
             INSERT INTO notes VALUES ('restored', NULL), ('trashed', '2026-09-01');
             INSERT INTO note_versions VALUES ('v1', 'restored'), ('v2', 'trashed');",
        )
        .unwrap();
        assert!(permanently_delete_trashed_note(&conn, "restored")
            .unwrap_err()
            .contains("已恢复"));
        permanently_delete_trashed_note(&conn, "trashed").unwrap();
        permanently_delete_trashed_note(&conn, "trashed").unwrap();
        let notes: String = conn
            .query_row("SELECT group_concat(id) FROM notes", [], |row| row.get(0))
            .unwrap();
        let versions: String = conn
            .query_row("SELECT group_concat(id) FROM note_versions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(notes, "restored");
        assert_eq!(versions, "v1");
    }
}

#[tauri::command]
pub fn clean_old_deleted(state: State<AppState>, older_than_days: i64) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(older_than_days)).to_rfc3339();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1)",
        rusqlite::params![cutoff],
    )
    .map_err(|e| e.to_string())?;
    let deleted = tx
        .execute(
            "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            rusqlite::params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

// ──── 原生对话框导出/导入（Tauri 桌面端专用）────

#[tauri::command]
pub fn export_to_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn export_binary_to_file(path: String, content: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn import_from_file(
    state: State<AppState>,
    config_state: State<'_, Mutex<AppConfig>>,
    data_dir: State<'_, DataDir>,
    path: String,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))?;
    import_data(state, config_state, data_dir, content, None)
}

#[tauri::command]
pub fn read_import_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

#[tauri::command]
pub fn export_note_markdown(state: State<AppState>, note_id: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let note = crate::db::models::select_note_by_id(&conn, &note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "note not found".to_string())?;
    Ok(crate::export::note_to_markdown(&note))
}
