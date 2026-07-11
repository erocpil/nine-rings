use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开/切换 Quick Capture 迷你窗口
///
/// 窗口不存在 → 创建（frameless、置顶、居中、400×280）
/// 窗口隐藏 → 显示 + 聚焦
/// 窗口可见 → 隐藏
#[tauri::command]
pub fn toggle_quick_capture(app: AppHandle) -> Result<(), String> {
    let label = "quick-capture";

    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?win=qc".into()),
    )
    .title("Quick Capture")
    .inner_size(400.0, 280.0)
    .min_inner_size(300.0, 200.0)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .center()
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = window.set_focus();
    Ok(())
}
