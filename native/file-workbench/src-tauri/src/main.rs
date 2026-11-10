#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod close_policy;
mod tools;
mod view_menu;
use close_policy::ClosePolicy;
use nine_rings_file_host::local_files;
use tauri::{Emitter, Manager};

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main workbench window may control its lifetime".into());
    }
    Ok(())
}
#[tauri::command]
fn workbench_ready(
    window: tauri::WebviewWindow,
    policy: tauri::State<'_, ClosePolicy>,
) -> Result<(), String> {
    main_window(&window)?;
    policy.ready();
    Ok(())
}
#[tauri::command]
fn workbench_confirm_close(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    policy: tauri::State<'_, ClosePolicy>,
) -> Result<(), String> {
    main_window(&window)?;
    if policy.confirm() {
        app.exit(0);
    }
    Ok(())
}
#[tauri::command]
fn workbench_set_view_menu(
    window: tauri::WebviewWindow,
    menu: tauri::State<'_, view_menu::ViewMenu>,
    enabled: bool,
    show_hidden: bool,
) -> Result<(), String> {
    main_window(&window)?;
    menu.hidden
        .set_enabled(enabled)
        .map_err(|e| e.to_string())?;
    menu.hidden
        .set_checked(show_hidden)
        .map_err(|e| e.to_string())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ClosePolicy::default())
        .setup(|app| {
            view_menu::install(app)?;
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            app.manage(local_files::LocalFiles::load(&directory));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.state::<ClosePolicy>().intercept() {
                    api.prevent_close();
                    let _ = window.emit("workbench:request-close", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            workbench_ready,
            tools::workbench_run_tool,
            workbench_set_view_menu,
            workbench_confirm_close,
            local_files::local_files_choose,
            local_files::local_files_roots,
            local_files::local_files_display_path,
            local_files::local_files_remove,
            local_files::local_files_rename,
            local_files::local_files_create,
            local_files::local_files_move,
            local_files::local_files_transfer,
            local_files::local_files_trash,
            local_files::local_files_list,
            local_files::local_files_read,
            local_files::local_files_write,
            local_files::local_files_read_asset,
            local_files::local_files_stat,
            local_files::local_files_digest,
            local_files::local_files_save_as,
            local_files::local_files_open_external,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build File Workbench")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<ClosePolicy>().intercept() {
                    api.prevent_exit();
                    let _ = app.emit_to("main", "workbench:request-close", ());
                }
            }
        });
}
