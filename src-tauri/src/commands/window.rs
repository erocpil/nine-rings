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
            static PREVIOUS: std::sync::Mutex<
                Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
            > = std::sync::Mutex::new(None);
            let result = (|| -> Result<(), String> {
                if target.is_fullscreen().map_err(|e| e.to_string())?
                    || target.is_maximized().map_err(|e| e.to_string())?
                {
                    return Ok(());
                }
                let mut previous = PREVIOUS.lock().map_err(|e| e.to_string())?;
                if let Some((position, size)) = *previous {
                    target.set_size(size).map_err(|e| e.to_string())?;
                    target.set_position(position).map_err(|e| e.to_string())?;
                    *previous = None;
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
                if let Err(error) =
                    target.set_position(tauri::PhysicalPosition::new(position.x, area.position.y))
                {
                    let _ = target.set_size(inner);
                    return Err(error.to_string());
                }
                *previous = Some((position, inner));
                Ok(())
            })();
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
    let label = format!("pdf-print-{}", uuid::Uuid::new_v4());
    let payload = serde_json::to_string(&html).map_err(|e| e.to_string())?;
    let job_title = serde_json::to_string(&title).map_err(|e| e.to_string())?;
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("pdf-print.html".into()))
        .title(format!("{} — PDF 打印预览", title))
        .inner_size(900.0, 850.0)
        .center()
        .initialization_script(format!(
            "window.__NR_PRINT_HTML = {}; window.__NR_PRINT_TITLE = {};",
            payload, job_title
        ))
        .on_navigation(|url| url.path() == "/pdf-print.html")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn print_pdf_document(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<(), String> {
    if !window.label().starts_with("pdf-print-") {
        return Err("只能打印文档预览窗口".into());
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos_print::print_document(&window, title.unwrap_or_else(|| "无标题".into())).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = title;
        window.print().map_err(|e| e.to_string())
    }
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
