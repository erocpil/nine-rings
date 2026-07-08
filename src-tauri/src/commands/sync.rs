use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn sync_push(state: State<AppState>) -> Result<crate::service::sync_service::SyncResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::service::sync_service::push(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_pull(state: State<AppState>) -> Result<crate::service::sync_service::SyncResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::service::sync_service::pull(&conn).map_err(|e| e.to_string())
}
