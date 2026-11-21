#[cfg(target_os = "macos")]
mod macos;

pub fn open_pdf_print_preview(
    app: tauri::AppHandle,
    title: String,
    html: String,
) -> Result<(), String> {
    let label = format!("pdf-print-{}", uuid::Uuid::new_v4());
    let payload = serde_json::to_string(&html).map_err(|e| e.to_string())?;
    let job_title = serde_json::to_string(&title).map_err(|e| e.to_string())?;
    let dev_origin = app.config().build.dev_url.as_ref().map(|url| url.origin());
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("pdf-print.html".into()))
        .title(format!("{} — PDF 打印预览", title))
        .inner_size(900.0, 850.0)
        .center()
        .initialization_script(format!(
            "window.__NR_PRINT_HTML = {}; window.__NR_PRINT_TITLE = {};",
            payload, job_title
        ))
        .on_navigation(move |url| {
            let bundled = matches!(
                (url.scheme(), url.host_str()),
                ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
            );
            let local_dev = cfg!(debug_assertions) && dev_origin.as_ref() == Some(&url.origin());
            url.path() == "/pdf-print.html" && (bundled || local_dev)
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn print_pdf_document(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<(), String> {
    if !window.label().starts_with("pdf-print-") {
        return Err("只能打印文档预览窗口".into());
    }
    #[cfg(target_os = "macos")]
    {
        macos::print_document(&window, title.unwrap_or_else(|| "无标题".into())).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = title;
        window.print().map_err(|e| e.to_string())
    }
}

pub async fn save_rendered_html(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    html: String,
) -> Result<bool, String> {
    crate::local_files::choose_save_bytes(app, window, name, html.into_bytes(), |_| Ok(()))
        .await
        .map(|path| path.is_some())
}
