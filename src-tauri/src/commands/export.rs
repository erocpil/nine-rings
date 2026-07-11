use crate::AppState;
use serde::{Deserialize, Serialize};
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
}

#[derive(Debug, Deserialize)]
pub struct DeleteOldInput {
    /// 删除多少天前的已删除笔记（默认 30）
    pub older_than_days: Option<i64>,
}

#[tauri::command]
pub fn export_data(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let bundle = crate::export::export_all(&conn).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data(state: State<AppState>, json: String) -> Result<ImportResult, String> {
    let bundle: crate::export::ExportBundle =
        serde_json::from_str(&json).map_err(|e| format!("parse error: {}", e))?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (n, p) = crate::export::import_bundle(&conn, &bundle).map_err(|e| e.to_string())?;
    Ok(ImportResult {
        notes_imported: n,
        pages_imported: p,
    })
}

// ──── 回收站 ────

#[tauri::command]
pub fn get_deleted_notes(state: State<AppState>) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
             FROM notes WHERE deleted_at IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| crate::db::models::note_from_row(row))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
    path: String,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))?;
    import_data(state, content)
}

#[tauri::command]
pub fn export_note_markdown(state: State<AppState>, note_id: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let note = crate::db::models::select_note_by_id(&conn, &note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "note not found".to_string())?;
    Ok(crate::export::note_to_markdown(&note))
}
