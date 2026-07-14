pub mod commands;
pub mod db;
pub mod export;
pub mod service;

use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::process::Command;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Emitter,
    Manager,
};

/// ── Windows Job Object: 主进程退出时内核自动杀死所有子进程 ──
/// ...
/// 注意：此函数定义在 `startup_log!` 宏之前，因此只用 `log::*` 宏输出；
/// 调用处会额外用 `startup_log!` 写入文件日志。
#[cfg(target_os = "windows")]
fn setup_job_object_kill_on_close() -> Result<(), String> {
    use std::sync::OnceLock;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;
    use windows::Win32::Foundation::HANDLE;
    use std::mem::size_of;

    static JOB_HANDLE: OnceLock<HANDLE> = OnceLock::new();

    let (result, handle) = unsafe {
        let job = CreateJobObjectW(None, None).map_err(|e| format!("CreateJobObjectW: {:?}", e))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            log::warn!("[JobObject] SetInformationJobObject: {:?}", e);
        }
        let r = AssignProcessToJobObject(job, GetCurrentProcess());
        (r, job)
    };
    match result {
        Ok(()) => {
            let _ = JOB_HANDLE.set(handle);
            log::info!("[JobObject] KILL_ON_CLOSE enabled — child processes auto-killed on exit");
            Ok(())
        }
        Err(e) => {
            log::warn!("[JobObject] AssignProcessToJobObject: {:?} — child processes NOT auto-killed", e);
            Err(format!("{:?}", e))
        }
    }
}

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

/// 查找并终止占用指定 profile 目录的孤儿 msedgewebview2.exe 进程。
/// 上次退出时如果 app.exit(0) 暴力终止，WebView2 子进程（GPU、渲染、Crashpad）
/// 可能变成孤儿，继续持有 EBWebView/ 下的文件锁，导致下次启动时 remove_dir_all 失败。
///
/// wmic 在 Windows 11 24H2+ 已被废弃且默认不安装；改用 taskkill /F /IM 全局终止。
/// 在用户的机器上通常只有本 App 会创建 WebView2 进程，因此安全。
#[cfg(target_os = "windows")]
fn kill_orphaned_webview2(profile_dir: &std::path::Path) {
    startup_log!("kill_orphaned_webview2: killing all msedgewebview2.exe");
    let result = Command::new("taskkill")
        .args(["/F", "/IM", "msedgewebview2.exe"])
        .output();
    match result {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout);
            startup_log!("kill_orphaned_webview2: taskkill result: {}", out.trim());
        }
        Err(e) => {
            startup_log!("kill_orphaned_webview2: taskkill failed: {}", e);
        }
    }
    // 等待进程真正退出
    std::thread::sleep(std::time::Duration::from_millis(300));
}

/// 尝试清理 WebView2 profile 目录。先杀孤儿进程，再删目录。
/// 删除成功返回 true，失败（被锁、权限不足等）返回 false 并在日志记录原因。
/// 如果删除失败，等待 500ms 后重试一次（等待潜在的文件锁释放）。
fn try_clean_webview2_profile(dir: &std::path::Path) -> bool {
    #[cfg(target_os = "windows")]
    kill_orphaned_webview2(dir);

    for attempt in 1..=2 {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => {
                startup_log!("try_clean_webview2_profile: removed {:?} (attempt {})", dir, attempt);
                return true;
            }
            Err(e) => {
                // Job Object 生效后理论上不应再触发此路径；若出现，说明 Job Object 分配失败
                // （如进程已在另一个 Job 中）或存在其他进程持有锁。
                log::error!("[ProfileCleanup] FAILED to remove {:?}: {} (os error {}, attempt {}/2) — this should not happen if Job Object is active; child processes may still be alive",
                    dir, e, e.raw_os_error().unwrap_or(-1), attempt);
                startup_log!("try_clean_webview2_profile: FAILED to remove {:?}: {} (os error {}, attempt {})",
                    dir, e, e.raw_os_error().unwrap_or(-1), attempt);
                if attempt < 2 {
                    // 可能子进程还没完全退出，等待后重试
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        }
    }
    false
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
        // 使用 PhysicalSize：inner_size() 返回物理像素，set_size 也传物理像素，避免 DPI 缩放
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            w + 1,
            h,
        )));
        std::thread::sleep(std::time::Duration::from_millis(16));
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            w,
            h,
        )));
        startup_log!("bump_webview2 done");
    } else {
        startup_log!("bump_webview2: inner_size() failed");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── 根治：主进程退出时内核自动杀死所有 WebView2 子进程 ──
    // 在任何 WebView2 相关操作（包括 tauri::Builder）之前设置 Job Object。
    // 此后无论 app.exit(0)、崩溃、还是被任务管理器强杀，Windows 内核都会
    // 立即清理所有 msedgewebview2.exe 子进程，不再需要 sleep / taskkill。
    #[cfg(target_os = "windows")]
    match setup_job_object_kill_on_close() {
        Ok(()) => {
            startup_log!("JobObject: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE enabled");
        }
        Err(e) => {
            startup_log!("JobObject: FAILED to enable KILL_ON_CLOSE — {} — child processes will NOT be auto-killed on exit", e);
        }
    }

    // WebView2 诊断与修复环境变量：
    //   --disable-gpu: 避免 GPU 驱动/shaders 导致的白屏（兜底）
    //   --enable-logging --v=1: 输出详细日志到 %TEMP%/webview2_debug.log，方便定位问题
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --enable-logging --v=1",
        );
        startup_log!("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set");
    }

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
            show_main_window(app);
        }))
        .setup(|app| {
            startup_log!("setup() begin");
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            startup_log!("app_data_dir={:?}", app_dir);
            std::fs::create_dir_all(&app_dir).ok();

            // ── WebView2 profile 清理（故障恢复策略，非每次启动都清）──
            // 如果上次退出不干净（子进程残留、持有文件锁），EBWebView 目录可能
            // 被锁定或损坏。启动时尝试清理：先杀孤儿进程，再删目录。
            // 删除失败不会阻塞启动——记录日志，让 WebView2 尝试使用现有 profile。
            // 正常情况下 profile 不存在或能成功删除，启动无额外开销。
            {
                let local_app_dir = app.path().app_local_data_dir().unwrap_or_else(|_| app_dir.clone());
                let wv_default = local_app_dir.join("EBWebView");
                let wv_custom = app_dir.join("webview-data");
                for dir in [&wv_default, &wv_custom] {
                    try_clean_webview2_profile(dir);
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

            // ── 系统托盘 ──
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
                            if button != MouseButton::Left || button_state != MouseButtonState::Down {
                                return;
                            }
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
                            "quit" => {
                                // ── 优雅退出：先让 WebView2 走正常关闭协议 ──
                                // app.exit(0) 是暴力终止，会留下孤儿 msedgewebview2.exe
                                // 子进程（GPU、渲染、Crashpad）继续持有 EBWebView 文件锁。
                                // cleanup_before_exit() 触发 WebView2/wry 的正常销毁流程，
                                // 释放资源后再退出。
                                startup_log!("quit requested — starting graceful shutdown");
                                // 先隐藏所有窗口，避免用户看到关闭过程
                                for (_, w) in app.webview_windows() {
                                    let _ = w.hide();
                                }
                                app.cleanup_before_exit();
                                // 给 WebView2 子进程一点收尾时间（Chromium 多进程架构
                                // 中 GPU/Renderer/Crashpad 可能比主进程晚一拍退出）
                                std::thread::sleep(std::time::Duration::from_millis(500));
                                startup_log!("graceful shutdown complete, exiting");
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .build(app)?;

                Ok(())
            })() {
                Ok(()) => { startup_log!("tray icon created"); log::info!("tray icon created"); },
                Err(e) => { startup_log!("tray FAILED: {}", e); log::error!("failed to create tray icon: {} (app will run without tray)", e); },
            }

            // ── Alt+Y 系统级全局热键 ──
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

            // ── F11 全屏切换 ──
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
                    let _ = window.hide();
                    api.prevent_close();
                } else {
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
