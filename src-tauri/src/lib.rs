pub mod commands;
pub mod db;
pub mod export;
pub mod service;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Emitter,
    Manager,
};

/// 启动日志：写入 %TEMP%/nine-rings-startup.log（Windows 上 stderr 不可见）。
/// 格式：`[HH:MM:SS.mmm] message`
macro_rules! startup_log {
    ($($arg:tt)*) => {{
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = now.as_secs();
        let millis = now.subsec_millis();
        let h = (secs / 3600) % 24;
        let m = (secs / 60) % 60;
        let s = secs % 60;
        let msg = format!($($arg)*);
        let line = format!("[{:02}:{:02}:{:02}.{:03}] {}\n", h, m, s, millis, msg);
        // 同时输出到 Rust log（如有配置则可见）和文件
        log::info!("{}", msg);
        if let Ok(dir) = std::env::var("TEMP").or_else(|_| std::env::var("TMPDIR")).or_else(|_| std::env::var("TMP")) {
            let path = std::path::PathBuf::from(dir).join("nine-rings-startup.log");
            let _ = std::fs::OpenOptions::new().create(true).append(true).open(&path)
                .map(|mut f| { let _ = std::io::Write::write_all(&mut f, line.as_bytes()); });
        }
    }};
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

/// 切换主窗口显示/隐藏（Alt+Y 等 toggle 型快捷键）
fn toggle_main_window(app: &tauri::AppHandle) {
    startup_log!("toggle_main_window called");
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            startup_log!("toggle_main_window: hiding");
            let _ = window.hide();
        } else {
            startup_log!("toggle_main_window: showing (visible={})", window.is_visible().unwrap_or(false));
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            #[cfg(target_os = "windows")]
            bump_webview2(&window);
        }
    }
}

/// 显示主窗口（托盘点击、二次启动等需确保显示的场景）
fn show_main_window(app: &tauri::AppHandle) {
    startup_log!("show_main_window called");
    if let Some(window) = app.get_webview_window("main") {
        startup_log!("show_main_window: window found, calling show (visible={})", window.is_visible().unwrap_or(false));
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        #[cfg(target_os = "windows")]
        bump_webview2(&window);
    } else {
        startup_log!("show_main_window: NO main window found!");
    }
}

/// Windows WebView2 hide/show 后合成器可能不重绘 → 强制 resize 触发 repaint
#[cfg(target_os = "windows")]
fn bump_webview2(window: &tauri::WebviewWindow) {
    startup_log!("bump_webview2 called");
    if let Ok(size) = window.inner_size() {
        let w = size.width;
        let h = size.height;
        startup_log!("bump_webview2: current size {}x{}, resizing to {}x{}", w, h, w+1, h);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            (w + 1).into(),
            h.into(),
        )));
        std::thread::sleep(std::time::Duration::from_millis(16));
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            w.into(),
            h.into(),
        )));
        startup_log!("bump_webview2 done");
    } else {
        startup_log!("bump_webview2: inner_size() failed");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_log!("=== nine-rings v{} ({}) startup begin ===", env!("CARGO_PKG_VERSION"), env!("GIT_HASH"));
    env_logger::init();
    startup_log!("env_logger initialized");

    startup_log!("building tauri app...");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            startup_log!("single_instance: second launch detected, showing main window");
            // 第二次双击 → 显示已有窗口，不创建新实例
            // show + unminimize 组合修复 Windows WebView2 hide/show 后白屏
            show_main_window(app);
        }))
        .setup(|app| {
            startup_log!("setup() begin");
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            startup_log!("app_data_dir={:?}", app_dir);
            std::fs::create_dir_all(&app_dir).ok();

            // ── WebView2 缓存：每次启动清空。
            // 用户数据在 SQLite（nine-rings.db）中持久化，WebView2 数据目录仅包含
            // 浏览器临时缓存、localStorage 等。hide()/show() 循环可能污染渲染状态，
            // 导致下次启动白屏；清空缓存是最可靠的预防措施。
            {
                let wv_dir = app_dir.join("webview-data");
                if wv_dir.exists() {
                    startup_log!("clearing WebView2 cache (always on startup)");
                    let _ = std::fs::remove_dir_all(&wv_dir);
                }
            }
            let db_path = app_dir.join("nine-rings.db");
            log::info!("database path: {:?}", db_path);

            startup_log!("opening database...");
            let conn = rusqlite::Connection::open(&db_path)
                .expect("failed to open database");
            startup_log!("running migrations...");
            db::migrations::run(&conn).expect("failed to run migrations");
            startup_log!("migrations done");

            // 加载配置
            startup_log!("loading config...");
            let user_config = commands::config::read_config(&app_dir);
            app.manage(Mutex::new(user_config));
            startup_log!("config loaded");

            app.manage(AppState {
                db: Mutex::new(conn),
            });
            startup_log!("state managed");

            // ── 系统托盘（非关键：失败不影响应用启动）──
            // 左键：显示/隐藏窗口  右键：弹出菜单
            startup_log!("setting up tray...");
            match (|| -> Result<_, Box<dyn std::error::Error>> {
                let show = MenuItemBuilder::with_id("show", "显示九环").build(app)?;
                let new_note = MenuItemBuilder::with_id("new_note", "新建随笔    Ctrl+N").build(app)?;
                let quick_cap = MenuItemBuilder::with_id("quick_capture", "快捷记录    Ctrl+Alt+N").build(app)?;
                let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
                let menu = MenuBuilder::new(app)
                    .item(&show)
                    .item(&new_note)
                    .item(&quick_cap)
                    .separator()
                    .item(&quit)
                    .build()?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("九环 · 左键显隐 · 右键菜单")
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button, button_state, .. } = event {
                            // 只响应按下（非释放），避免双击效果
                            if button != MouseButton::Left || button_state != MouseButtonState::Down {
                                return;
                            }
                            // 左键：toggle 窗口显隐
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    #[cfg(target_os = "windows")]
                                    bump_webview2(&window);
                                }
                            }
                        }
                    })
                    .on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "show" => {
                                show_main_window(app);
                            }
                            "new_note" => {
                                show_main_window(app);
                                let app_clone = app.clone();
                                // 延迟 emit：等 WebView 完成重绘 + React 挂载事件监听
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_millis(300));
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let _ = window.emit("tray-new-note", ());
                                    }
                                });
                            }
                            "quick_capture" => {
                                let _ = commands::quick_capture::toggle_quick_capture(app.clone());
                            }
                            "quit" => app.exit(0),
                            _ => {}
                        }
                    })
                    .build(app)?;

                Ok(())
            })() {
                Ok(()) => { startup_log!("tray icon created"); log::info!("tray icon created"); },
                Err(e) => { startup_log!("tray FAILED: {}", e); log::error!("failed to create tray icon: {} (app will run without tray)", e); },
            }

            // ── Alt+Y 系统级全局热键（Rust 端，不依赖 WebView）──
            {
                startup_log!("registering Alt+Y shortcut...");
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                use tauri_plugin_global_shortcut::ShortcutState;

                let app_h = app.handle().clone();
                if let Err(e) = app.global_shortcut().on_shortcut(
                    "Alt+Y",
                    move |_app, _s, event| {
                        if event.state == ShortcutState::Pressed {
                            toggle_main_window(&app_h);
                        }
                    },
                ) {
                    startup_log!("Alt+Y shortcut FAILED: {}", e);
                    log::warn!("failed to register Alt+Y global shortcut: {}", e);
                } else {
                    startup_log!("Alt+Y shortcut registered");
                }
            }

            // ── F11 全屏切换（Rust 端系统级快捷键，不依赖 WebView）──
            {
                startup_log!("registering F11 shortcut...");
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                use tauri_plugin_global_shortcut::ShortcutState;

                let app_h = app.handle().clone();
                if let Err(e) = app.global_shortcut().on_shortcut(
                    "F11",
                    move |_app, _s, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = app_h.get_webview_window("main") {
                                let is_fs = window.is_fullscreen().unwrap_or(false);
                                let _ = window.set_fullscreen(!is_fs);
                            }
                        }
                    },
                ) {
                    startup_log!("F11 shortcut FAILED: {}", e);
                    log::warn!("failed to register F11 global shortcut: {}", e);
                } else {
                    startup_log!("F11 shortcut registered");
                }
            }

            startup_log!("setup() complete, returning Ok(())");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                startup_log!("window_event CloseRequested label={}", window.label());
                if window.label() == "quick-capture" {
                    // Quick Capture 窗口：只隐藏，不销毁（复用 WebView）
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    // 主窗口：关闭 → 隐藏到托盘
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
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
            commands::config::get_config,
            commands::config::set_config,
            commands::export::export_data,
            commands::export::import_data,
            commands::export::export_to_file,
            commands::export::import_from_file,
            commands::export::get_deleted_notes,
            commands::export::restore_note,
            commands::export::permanently_delete_note,
            commands::export::clean_old_deleted,
            commands::export::export_note_markdown,
            commands::sync::sync_push,
            commands::sync::sync_pull,
            commands::doc_tree::search_docs,
            commands::doc_tree::get_notes_by_path,
            commands::doc_tree::get_all_concepts,
            commands::doc_tree::get_path_tree,
            commands::quick_capture::toggle_quick_capture,
            commands::quick_capture::emit_to_main,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    startup_log!("=== nine-rings exiting ===");
}
