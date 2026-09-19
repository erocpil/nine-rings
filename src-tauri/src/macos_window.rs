//! Main-thread-only geometry management for our frameless macOS main window.
use crate::window_placement::WindowPlacement;
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSWindow, NSWindowDidExitFullScreenNotification, NSWindowStyleMask};
use objc2_foundation::{NSNotificationCenter, NSObjectProtocol, NSRect};
use std::{cell::RefCell, collections::HashMap};

#[derive(Default)]
struct WindowState {
    placement: WindowPlacement<NSRect>,
    style: Option<NSWindowStyleMask>,
    // The main window hides to the tray and lives until process exit, as does
    // its observer. Retain exactly one token per window, not per transition.
    observer: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

thread_local! {
    static STATES: RefCell<HashMap<String, WindowState>> = RefCell::default();
}

fn same_frame(a: NSRect, b: NSRect) -> bool {
    (a.origin.x - b.origin.x).abs() < 1.0
        && (a.origin.y - b.origin.y).abs() < 1.0
        && (a.size.width - b.size.width).abs() < 1.0
        && (a.size.height - b.size.height).abs() < 1.0
}

pub fn toggle_maximize(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // SAFETY: callers dispatch to the UI thread and the live Tauri window owns
    // this NSWindow. Do not retain this borrowed reference across callbacks.
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    if window.is_fullscreen()? || native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return Ok(());
    }
    let Some(screen) = native.screen() else {
        return Ok(());
    };
    let current = native.frame();
    let maximized = screen.visibleFrame();
    let target = STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.entry(window.label().to_owned()).or_default();
        if state.placement.transitioning() {
            return None;
        }
        Some(
            state
                .placement
                .toggle_zoom(current, maximized, same_frame(current, maximized)),
        )
    });
    if let Some(frame) = target {
        // Synchronous geometry avoids Tao's queued zoom overwriting its saved
        // standard frame after the temporary fullscreen titlebar is installed.
        native.setFrame_display(frame, true);
    }
    Ok(())
}

pub fn set_fullscreen(window: &tauri::WebviewWindow, fullscreen: bool) -> tauri::Result<()> {
    if fullscreen && !window.is_fullscreen()? {
        let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        STATES.with(|states| {
            let mut states = states.borrow_mut();
            let state = states.entry(window.label().to_owned()).or_default();
            state.placement.begin_fullscreen(native.frame());
            state.style.get_or_insert(native.styleMask());
            if state.observer.is_none() {
                let target = window.clone();
                let callback = RcBlock::new(move |_| {
                    let target = target.clone();
                    // Tao queues restoration of the borderless style in its
                    // did-exit delegate. Run after those queued operations,
                    // never on an intermediate resize or an arbitrary timer.
                    DispatchQueue::main().exec_async(move || {
                        // Notification observers have no guaranteed ordering.
                        // A second queue turn also covers a delegate notified
                        // after this observer that queues its own style change.
                        DispatchQueue::main().exec_async(move || {
                            if let Err(error) = restore_after_fullscreen(&target) {
                                log::warn!("failed to restore macOS window frame: {error}");
                            }
                        });
                    });
                });
                state.observer = Some(unsafe {
                    NSNotificationCenter::defaultCenter()
                        .addObserverForName_object_queue_usingBlock(
                            Some(NSWindowDidExitFullScreenNotification),
                            Some(native),
                            None,
                            &callback,
                        )
                });
            }
        });
    }
    let result = window.set_fullscreen(fullscreen);
    if result.is_err() && fullscreen {
        STATES.with(|states| {
            if let Some(state) = states.borrow_mut().get_mut(window.label()) {
                state.placement.finish_fullscreen();
                state.style = None;
            }
        });
    }
    result
}

fn restore_after_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    // A rapid opposite request may already have begun another Space transition.
    if window.is_fullscreen()? || native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return Ok(());
    }
    let restore = STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.get_mut(window.label())?;
        Some((state.placement.finish_fullscreen()?, state.style.take()?))
    });
    if let Some((frame, style)) = restore {
        native.setStyleMask(style);
        native.setFrame_display(frame, true);
        // Changing style rebuilds the titlebar/content hierarchy. Restore the
        // content size too, so the temporary native titlebar cannot leave an
        // inset above the webview. Keep keyboard input directed at that view.
        if let Some(view) = native.contentView() {
            view.setFrameSize(native.contentRectForFrameRect(frame).size);
            native.makeFirstResponder(Some(&view));
        }
    }
    Ok(())
}
