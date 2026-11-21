/// Only the main application can finish the save-before-quit handshake.
#[tauri::command]
pub fn quit_application(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口退出应用".into());
    }
    crate::graceful_quit(&app, "confirmed-keyboard");
    Ok(())
}

/// Complete the whole transition on the UI thread. Individual Tauri setters
/// otherwise only enqueue work, allowing button and shortcut requests to race.
#[tauri::command]
pub async fn set_window_fullscreen(
    window: tauri::WebviewWindow,
    fullscreen: bool,
) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = crate::fullscreen::set_fullscreen(&target, fullscreen)
                .map_err(|error| error.to_string());
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("fullscreen transition cancelled")?
}

/// Use the same native fullscreen-to-tray transition as Option+Y and tray clicks.
#[tauri::command]
pub async fn hide_window_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = if target.label() == "main" {
                crate::hide_main_window_to_tray(&target);
                Ok(())
            } else {
                Err("只能隐藏主窗口到托盘".to_owned())
            };
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("hide to tray transition cancelled")?
}

#[tauri::command]
pub async fn toggle_window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result = crate::macos_window::toggle_maximize(&target);
            #[cfg(not(target_os = "macos"))]
            let result = target.is_maximized().and_then(|maximized| {
                if maximized {
                    target.unmaximize()
                } else {
                    target.maximize()
                }
            });
            let _ = sender.try_send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("maximize transition cancelled")?
}
/// Stretch only the main window's vertical extent to the monitor work area.
/// Keep frame decoration in the calculation: set_size expects the inner size.
#[tauri::command]
pub async fn toggle_window_vertical_extent(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能调整主窗口尺寸".into());
    }
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result =
                crate::macos_window::toggle_vertical_extent(&target).map_err(|e| e.to_string());
            #[cfg(not(target_os = "macos"))]
            let result = {
                static PREVIOUS: std::sync::Mutex<
                    Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
                > = std::sync::Mutex::new(None);
                (|| -> Result<(), String> {
                    if target.is_fullscreen().map_err(|e| e.to_string())? {
                        return Ok(());
                    }
                    let mut previous = PREVIOUS.lock().map_err(|e| e.to_string())?;
                    if let Some((position, size)) = *previous {
                        target.set_size(size).map_err(|e| e.to_string())?;
                        target.set_position(position).map_err(|e| e.to_string())?;
                        *previous = None;
                        return Ok(());
                    }
                    if target.is_maximized().map_err(|e| e.to_string())? {
                        return Ok(());
                    }
                    let monitor = target
                        .current_monitor()
                        .map_err(|e| e.to_string())?
                        .ok_or("无法确定当前屏幕")?;
                    let position = target.outer_position().map_err(|e| e.to_string())?;
                    let inner = target.inner_size().map_err(|e| e.to_string())?;
                    let outer = target.outer_size().map_err(|e| e.to_string())?;
                    let area = monitor.work_area();
                    let height = area
                        .size
                        .height
                        .saturating_sub(outer.height.saturating_sub(inner.height))
                        .max(1);
                    target
                        .set_size(tauri::PhysicalSize::new(inner.width, height))
                        .map_err(|e| e.to_string())?;
                    if let Err(error) = target
                        .set_position(tauri::PhysicalPosition::new(position.x, area.position.y))
                    {
                        let _ = target.set_size(inner);
                        return Err(error.to_string());
                    }
                    *previous = Some((position, inner));
                    Ok(())
                })()
            };
            let _ = sender.try_send(result);
        })
        .map_err(|e| e.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("vertical extent transition cancelled")?
}

/// Separate document WebView: macOS WKWebView does not implement iframe window.print().
#[tauri::command]
pub async fn open_pdf_print_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    title: String,
    html: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口导出文档".into());
    }
    nine_rings_file_host::pdf_print::open_pdf_print_preview(app, title, html)
}

#[tauri::command]
pub async fn print_pdf_document(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<(), String> {
    nine_rings_file_host::pdf_print::print_pdf_document(window, title).await
}

#[tauri::command]
pub async fn save_rendered_html(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    html: String,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("只能从主窗口导出文档".into());
    }
    nine_rings_file_host::pdf_print::save_rendered_html(app, window, name, html).await
}

#[tauri::command]
pub fn get_desktop_recovery_status(
    window: tauri::WebviewWindow,
    state: tauri::State<crate::desktop_lifecycle::DesktopLifecycle>,
) -> Result<crate::desktop_lifecycle::Status, String> {
    if window.label() != "main" {
        return Err("只能从主窗口查看诊断".into());
    }
    Ok(state.snapshot())
}
