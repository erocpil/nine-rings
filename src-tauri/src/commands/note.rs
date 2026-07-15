use crate::service;
use crate::AppState;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct UpdateTodosInput {
    pub date: String,
    pub todos: Vec<crate::db::models::Todo>,
    pub todo_carryover: Option<bool>,
}

#[tauri::command]
pub fn get_note(state: State<AppState>, id: String) -> Result<Option<crate::db::models::Note>, String> {
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
