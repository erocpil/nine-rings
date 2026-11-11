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
    if window.state::<tools::ToolJobs>().active() {
        return Err("命令行工具仍在运行，请等待执行完成后退出。".into());
    }
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
fn show_workbench(app: &tauri::AppHandle) {
    app.state::<ClosePolicy>().take_deferred_hide();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn hide_workbench(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Closing and tray toggling share the same fullscreen-to-hidden transition.
    if window.is_fullscreen().unwrap_or(false) {
        window.state::<ClosePolicy>().defer_hide();
        if window.set_fullscreen(false).is_err() {
            window.state::<ClosePolicy>().take_deferred_hide();
            let _ = window.hide();
        }
    } else {
        let _ = window.hide();
    }
}
fn toggle_workbench(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if close_policy::should_hide(
        window.is_visible().unwrap_or(false),
        window.is_minimized().unwrap_or(true),
        window.is_focused().unwrap_or(false),
    ) {
        hide_workbench(app);
    } else {
        show_workbench(app);
    }
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
        .manage(tools::ToolJobs::default())
        .setup(|app| {
            view_menu::install(app)?;
            let show = tauri::menu::MenuItem::with_id(
                app,
                "workbench.show",
                "显示 File Workbench",
                true,
                None::<&str>,
            )?;
            let quit =
                tauri::menu::MenuItem::with_id(app, "workbench.quit", "退出", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
            let mut tray = tauri::tray::TrayIconBuilder::with_id("workbench")
                .tooltip("File Workbench · 左键显隐 · 右键菜单")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "workbench.show" => show_workbench(app),
                    "workbench.quit" => {
                        show_workbench(app);
                        let _ = app.emit_to("main", "workbench:request-close", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Down,
                            ..
                        }
                    ) {
                        toggle_workbench(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            app.manage(local_files::LocalFiles::load(&directory));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::Resized(_))
                && !window.is_fullscreen().unwrap_or(true)
                && window.state::<ClosePolicy>().take_deferred_hide()
            {
                let _ = window.hide();
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    // Hiding retains editors, drafts and running jobs. Only confirmed quit destroys them.
                    hide_workbench(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            workbench_ready,
            tools::workbench_run_tool,
            tools::workbench_tool_status,
            tools::workbench_stop_tool,
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
            local_files::local_files_properties,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build File Workbench")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_workbench(app);
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<ClosePolicy>().intercept() {
                    api.prevent_exit();
                    let _ = app.emit_to("main", "workbench:confirm-quit", ());
                }
            }
        });
}
