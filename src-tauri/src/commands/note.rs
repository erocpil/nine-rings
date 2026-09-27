use crate::db::models::{NotePublic, UpsertNoteInput};
use crate::service;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_note(
    state: State<AppState>,
    id: String,
) -> Result<Option<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::db::models::select_note_by_id(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note_order(
    state: State<AppState>,
    id: String,
    sort_order: i32,
) -> Result<crate::db::models::Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::reorder_note(&conn, &id, sort_order)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "note not found".to_string())
}

#[tauri::command]
pub fn search_notes(
    state: State<AppState>,
    query: String,
) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::search_notes(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes_by_tag(
    state: State<AppState>,
    tag: String,
) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_notes_by_tag(&conn, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_all_tags(&conn).map_err(|e| e.to_string())
}

/// upsertNote 命令：调用 `db::models::upsert_note`（单个 `BEGIN IMMEDIATE` 事务内查重 + 写入）。
///
/// 匹配谓词与 TS `core.ts::upsertMatchKey` 对齐：
/// - 显式 id（导入透传）→ 直接使用。
/// - 文档：storage_path + title。
/// - 未指定 storage_path 时使用 references。
///
/// 多命中时按 `updated_at DESC, id ASC` 取首条，保证确定性。
#[tauri::command]
pub fn upsert_note(state: State<AppState>, data: UpsertNoteInput) -> Result<NotePublic, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let note = crate::db::models::upsert_note_dedup(&mut conn, &data).map_err(|e| e.to_string())?;
    Ok(note.to_public())
}
