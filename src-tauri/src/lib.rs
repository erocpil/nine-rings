pub mod commands;
pub mod db;
pub mod export;
pub mod service;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("note-sticky.db");
            log::info!("database path: {:?}", db_path);

            let conn = rusqlite::Connection::open(&db_path)
                .expect("failed to open database");
            db::migrations::run(&conn).expect("failed to run migrations");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::note::get_notes_by_date,
            commands::note::create_note,
            commands::note::update_note,
            commands::note::update_note_order,
            commands::note::delete_note,
            commands::note::search_notes,
            commands::note::get_notes_by_tag,
            commands::note::get_all_tags,
            commands::note::get_daily_page,
            commands::note::update_todos,
            commands::note::get_note_versions,
            commands::note::restore_note_version,
            commands::export::export_data,
            commands::export::import_data,
            commands::export::get_deleted_notes,
            commands::export::restore_note,
            commands::export::permanently_delete_note,
            commands::export::clean_old_deleted,
            commands::export::export_note_markdown,
            commands::sync::sync_push,
            commands::sync::sync_pull,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
