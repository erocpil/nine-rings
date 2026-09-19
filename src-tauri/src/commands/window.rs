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
