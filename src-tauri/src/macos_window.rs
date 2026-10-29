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
    vertical_restore: Option<NSRect>,
    hide_after_fullscreen: bool,
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

/// Whether custom window chrome currently owns a temporary expanded frame.
/// Such a frame must not replace the user's ordinary size on disk.
pub fn is_temporarily_expanded(window: &tauri::WebviewWindow) -> tauri::Result<bool> {
    let _native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    Ok(STATES.with(|states| {
        states.borrow().get(window.label()).is_some_and(|state| {
            state.placement.has_zoom_restore_frame()
                || state.placement.transitioning()
                || state.vertical_restore.is_some()
        })
    }))
}

/// Preserve horizontal geometry and use Cocoa's work area in native coordinates.
pub fn toggle_vertical_extent(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // SAFETY: this command is dispatched to the UI thread, as is toggle_maximize.
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    if window.is_fullscreen()? || native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return Ok(());
    }
    let Some(screen) = native.screen() else {
        return Ok(());
    };
    let current = native.frame();
    let area = screen.visibleFrame();
    let frame = STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.entry(window.label().to_owned()).or_default();
        if state.placement.transitioning() {
            return None;
        }
        if let Some(previous) = state.vertical_restore.take() {
            return Some(previous);
        }
        state.vertical_restore = Some(current);
        let mut expanded = current;
        expanded.origin.y = area.origin.y;
        expanded.size.height = area.size.height;
        Some(expanded)
    });
    if let Some(frame) = frame {
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

/// Hide from an OS-level shortcut or tray action only after macOS has removed
/// the fullscreen Space. `set_fullscreen(false)` is asynchronous on Cocoa.
pub fn hide_to_tray(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    if !window.is_fullscreen()? && !native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return window.hide();
    }
    STATES.with(|states| {
        states
            .borrow_mut()
            .entry(window.label().to_owned())
            .or_default()
            .hide_after_fullscreen = true;
    });
    if let Err(error) = set_fullscreen(window, false) {
        STATES.with(|states| {
            if let Some(state) = states.borrow_mut().get_mut(window.label()) {
                state.hide_after_fullscreen = false;
            }
        });
        return Err(error);
    }
    Ok(())
}

fn restore_after_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    // A rapid opposite request may already have begun another Space transition.
    if window.is_fullscreen()? || native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return Ok(());
    }
    let pending = STATES.with(|states| {
        let mut states = states.borrow_mut();
        let state = states.get_mut(window.label())?;
        let hide = std::mem::take(&mut state.hide_after_fullscreen);
        let restore = state.placement.finish_fullscreen().zip(state.style.take());
        Some((restore, hide))
    });
    if let Some((restore, hide)) = pending {
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
        if hide {
            window.hide()?;
        }
    }
    Ok(())
}
