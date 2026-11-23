#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod buffers;
mod close_policy;
mod editor_session;
mod editor_window;
mod external_open;
#[cfg(target_os = "macos")]
mod macos_zoom;
mod tools;
mod view_menu;
mod window_activation;
#[cfg(any(target_os = "macos", test))]
mod window_zoom;
use close_policy::ClosePolicy;
use nine_rings_file_host::local_files;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct StartupNotices(std::sync::Mutex<Vec<String>>);

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
    if let Ok(mut notices) = window.state::<StartupNotices>().0.lock() {
        if !notices.is_empty() {
            let omitted = notices.len().saturating_sub(8);
            let mut message = notices
                .iter()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n\n");
            if omitted > 0 {
                message.push_str(&format!("\n另有 {omitted} 项，请检查应用数据目录。"));
            }
            notices.clear();
            window
                .dialog()
                .message(message)
                .title("File Workbench · 恢复记录")
                .kind(MessageDialogKind::Warning)
                .show(|_| {});
        }
    }
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
    if editor_window::window(&app).is_some() {
        return editor_window::request_close(&app, true);
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
#[tauri::command]
async fn workbench_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result = macos_zoom::toggle(&target);
            #[cfg(not(target_os = "macos"))]
            let result = target.is_fullscreen().and_then(|fullscreen| {
                if fullscreen {
                    return Ok(());
                }
                target.is_maximized().and_then(|maximized| {
                    if maximized {
                        target.unmaximize()
                    } else {
                        target.maximize()
                    }
                })
            });
            let _ = sender.try_send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("Window zoom cancelled")?
}
fn show_workbench(app: &tauri::AppHandle) {
    app.state::<ClosePolicy>().take_deferred_hide();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn show_last_window(app: &tauri::AppHandle) {
    let label = app.state::<window_activation::WindowActivation>().current();
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        show_workbench(app);
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
    let (open_requests, requests) = tauri::async_runtime::channel(32);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = external_open::argument_paths(
                argv.into_iter().skip(1).map(std::ffi::OsString::from),
                std::path::Path::new(&cwd),
            );
            if !external_open::submit(app, paths) {
                show_last_window(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ClosePolicy::default())
        .manage(window_activation::WindowActivation::default())
        .manage(editor_window::EditorWindows::default())
        .manage(external_open::Requests(open_requests))
        .manage(nine_rings_file_host::window_access::FileWindowAccess::default())
        .manage(tools::ToolJobs::default())
        .setup(move |app| {
            view_menu::install(app)?;
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                macos_zoom::install(&window)?;
            }
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
            let library = local_files::LocalFiles::load(&directory);
            let mut notices = Vec::new();
            app.manage(buffers::BufferDocuments::load(
                &directory.join("editor-documents"),
                &mut notices,
            ));
            let mut sessions = editor_session::EditorSessionStore::load(
                &directory.join("editor-session.json"),
                &mut notices,
            );
            if let Err(error) = sessions.recover_relocation(&library, &mut notices) {
                notices.push(format!("移动记录暂不可用（{error}）。"));
            }
            app.manage(library);
            app.manage(sessions);
            app.manage(StartupNotices(std::sync::Mutex::new(notices)));
            app.state::<editor_session::EditorSessionStore>()
                .restoring
                .store(true, std::sync::atomic::Ordering::SeqCst);
            let cwd = std::env::current_dir().unwrap_or_default();
            external_open::submit(
                app.handle(),
                external_open::argument_paths(std::env::args_os().skip(1), &cwd),
            );
            tauri::async_runtime::spawn(external_open::process(app.handle().clone(), requests));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                window
                    .state::<window_activation::WindowActivation>()
                    .record(window.label());
            }
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::Resized(_))
                && !window.is_fullscreen().unwrap_or(true)
                && window.state::<ClosePolicy>().take_deferred_hide()
            {
                let _ = window.hide();
            }
            if window.label().starts_with("workbench-editor-")
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                editor_window::destroyed(window.app_handle(), window.label());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("workbench-editor-") {
                    api.prevent_close();
                    let _ = editor_window::request_close(window.app_handle(), false);
                }
                if window.label() == "main" {
                    api.prevent_close();
                    // Hiding retains editors, drafts and running jobs. Only confirmed quit destroys them.
                    hide_workbench(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            buffers::workbench_new_document,
            buffers::workbench_buffer_read,
            buffers::workbench_buffer_checkpoint,
            buffers::workbench_buffer_snapshot,
            buffers::workbench_buffer_save,
            buffers::workbench_buffer_discard,
            buffers::workbench_reopen_drafts,
            editor_window::workbench_window_role,
            editor_window::workbench_editor_presence,
            editor_window::workbench_open_editor,
            editor_window::open_pdf_print_preview,
            editor_window::print_pdf_document,
            editor_window::save_rendered_html,
            editor_window::relocation::workbench_move_open_file,
            editor_window::relocation::workbench_editor_relocation_reply,
            editor_window::relocation::workbench_editor_relocation_preferences_done,
            editor_window::workbench_follow_editor_link,
            editor_window::workbench_editor_link_origin,
            editor_window::workbench_editor_state,
            editor_window::workbench_editor_select,
            editor_window::workbench_editor_reorder,
            editor_window::workbench_editor_remove,
            editor_window::workbench_editor_saved,
            editor_window::workbench_editor_finish_close,
            editor_window::workbench_editor_confirm_file,
            editor_window::workbench_editor_request_quit,
            editor_window::workbench_show_browser,
            editor_window::workbench_show_editor,
            workbench_ready,
            workbench_toggle_maximize,
            tools::workbench_run_tool,
            tools::workbench_tool_status,
            tools::workbench_stop_tool,
            workbench_set_view_menu,
            view_menu::workbench_set_editor_menu,
            workbench_confirm_close,
            local_files::local_files_choose,
            local_files::local_files_roots,
            local_files::local_files_display_path,
            local_files::local_files_remove,
            local_files::local_files_rename,
            local_files::local_files_create,
            local_files::local_files_move,
            local_files::local_files_transfer,
            local_files::replacement::workbench_preview_replacement,
            local_files::replacement::workbench_replace_file,
            local_files::local_files_trash,
            local_files::local_files_list,
            local_files::local_files_resolve_link,
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
            if let tauri::RunEvent::Opened { urls } = &event {
                external_open::submit(app, urls.iter().filter_map(|url| url.to_file_path().ok()));
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Exit) {
                macos_zoom::remove();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                show_last_window(app);
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<ClosePolicy>().intercept() {
                    api.prevent_exit();
                    let _ = app.emit_to("main", "workbench:confirm-quit", ());
                }
            }
        });
}
