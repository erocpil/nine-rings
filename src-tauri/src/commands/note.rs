use crate::service;
use crate::AppState;
use serde::Deserialize;
use tauri::State;

use crate::service::note_service::NoteVersion;

#[derive(Debug, Deserialize)]
pub struct CreateNoteInput {
    pub date: String,
    pub title: Option<String>,
    pub content: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteInput {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTodosInput {
    pub date: String,
    pub todos: Vec<crate::db::models::Todo>,
    pub todo_carryover: Option<bool>,
}

#[tauri::command]
pub fn get_notes_by_date(state: State<AppState>, date: String) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_notes_by_date(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    data: CreateNoteInput,
) -> Result<crate::db::models::Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::create_note(
        &conn,
        &data.date,
        data.title.as_deref(),
        &data.content.unwrap_or(serde_json::json!({"ops": []})),
        &data.tags,
        data.pinned,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(
    state: State<AppState>,
    id: String,
    data: UpdateNoteInput,
) -> Result<crate::db::models::Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::update_note_with_version(
        &conn,
        &id,
        data.title.as_deref(),
        &data.content.unwrap_or(serde_json::Value::Null),
        data.tags.as_deref(),
        data.pinned,
        data.sort_order,
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "note not found".to_string())
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
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::delete_note(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(state: State<AppState>, query: String) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::search_notes(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes_by_tag(state: State<AppState>, tag: String) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_notes_by_tag(&conn, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_all_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_daily_page(state: State<AppState>, date: String) -> Result<crate::db::models::DailyPage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_or_create_daily_page(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_todos(
    state: State<AppState>,
    data: UpdateTodosInput,
) -> Result<crate::db::models::DailyPage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::update_todos(
        &conn,
        &data.date,
        &data.todos,
        data.todo_carryover.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

// ──── 版本历史 ────

#[tauri::command]
pub fn get_note_versions(state: State<AppState>, note_id: String) -> Result<Vec<NoteVersion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::get_note_versions(&conn, &note_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_note_version(state: State<AppState>, version_id: String) -> Result<crate::db::models::Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    service::note_service::restore_note_version(&conn, &version_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "version not found".to_string())
}
