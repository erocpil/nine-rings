//! Explicit document print layout; Wry's default print() overwrites native margins with zero.
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintOperation};
use objc2_foundation::{NSCopying, NSSize, NSString};

const POINTS_PER_MM: f64 = 72.0 / 25.4;

/// Prepare and display the native operation on the WebView's UI thread.
pub async fn print_document(window: &tauri::WebviewWindow, title: String) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |platform| {
            let result = (|| {
                // SAFETY: with_webview executes on the UI thread. The PlatformWebview
                // owns the live WKWebView and NSWindow for the duration of this closure.
                unsafe {
                    if platform.inner().is_null() || platform.ns_window().is_null() {
                        return Err("打印预览窗口已关闭".to_owned());
                    }
                    let webview = &*platform.inner().cast::<AnyObject>();
                    let can_print: bool = msg_send![webview, respondsToSelector: objc2::sel!(printOperationWithPrintInfo:)];
                    if !can_print {
                        return Err("当前 macOS WebKit 不支持原生打印".to_owned());
                    }
                    // Use a private copy: do not change the app/system shared print settings.
                    let info = NSPrintInfo::sharedPrintInfo().copy();
                    info.setPaperSize(NSSize::new(210.0 * POINTS_PER_MM, 297.0 * POINTS_PER_MM));
                    info.setOrientation(NSPaperOrientation::Portrait);
                    info.setTopMargin(18.0 * POINTS_PER_MM);
                    info.setBottomMargin(20.0 * POINTS_PER_MM);
                    info.setLeftMargin(17.0 * POINTS_PER_MM);
                    info.setRightMargin(17.0 * POINTS_PER_MM);
                    info.setHorizontallyCentered(false);
                    info.setVerticallyCentered(false);
                    let operation: Retained<NSPrintOperation> =
                        msg_send![webview, printOperationWithPrintInfo: &*info];
                    operation.setJobTitle(Some(&NSString::from_str(&title)));
                    operation.setCanSpawnSeparateThread(true);
                    operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        &*platform.ns_window().cast(),
                        None,
                        None,
                        std::ptr::null_mut(),
                    );
                    Ok(())
                }
            })();
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("打印预览窗口已关闭")?
}
