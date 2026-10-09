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
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("pdf-print.html".into()))
        .title(format!("{} — PDF 打印预览", title))
        .inner_size(900.0, 850.0)
        .center()
        .initialization_script(format!("window.__NR_PRINT_HTML = {};", payload))
        .on_navigation(|url| url.path() == "/pdf-print.html")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn print_pdf_document(window: tauri::WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("pdf-print-") {
        return Err("只能打印文档预览窗口".into());
    }
    window.print().map_err(|e| e.to_string())
}
