//! Only our decorated main window's title double-clicks are intercepted.
//! Local monitors require no global input/accessibility permission.
use crate::window_zoom::ZoomRestore;
use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::NSRect;
use std::{cell::RefCell, ptr::NonNull};

#[derive(Default)]
struct State {
    zoom: ZoomRestore<NSRect>,
    monitor: Option<Retained<AnyObject>>,
}
thread_local! { static STATE: RefCell<State> = RefCell::default(); }

/// Both IPC and the local event monitor call this on the AppKit main thread.
pub fn toggle(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // SAFETY: UI thread, live NSWindow owned by this WebviewWindow.
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    if native.styleMask().contains(NSWindowStyleMask::FullScreen) || window.is_fullscreen()? {
        return Ok(());
    }
    let Some(screen) = native.screen() else {
        return Ok(());
    };
    let frame = STATE.with(|state| {
        state
            .borrow_mut()
            .zoom
            .toggle(native.frame(), screen.visibleFrame())
    });
    // Do not hold the RefCell borrow across synchronous native resize callbacks.
    native.setFrame_display(frame, true);
    Ok(())
}

pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    remove();
    let target = window.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit supplies a live event for this callback.
        let mouse = unsafe { event.as_ref() };
        let Ok(pointer) = target.ns_window() else {
            return event.as_ptr();
        };
        let native = unsafe { &*pointer.cast::<NSWindow>() };
        let point = mouse.locationInWindow();
        let content = native.contentRectForFrameRect(native.frame());
        // Keep traffic-light buttons, web content, other windows and fullscreen native.
        if mouse.windowNumber() != native.windowNumber()
            || mouse.clickCount() != 2
            || point.y < content.size.height
            || native.styleMask().contains(NSWindowStyleMask::FullScreen)
        {
            return event.as_ptr();
        }
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = native.standardWindowButton(kind) {
                let bounds = button.convertRect_toView(button.bounds(), None);
                if point.x >= bounds.origin.x
                    && point.x <= bounds.origin.x + bounds.size.width
                    && point.y >= bounds.origin.y
                    && point.y <= bounds.origin.y + bounds.size.height
                {
                    return event.as_ptr();
                }
            }
        }
        if mouse.r#type() == objc2_app_kit::NSEventType::LeftMouseDown {
            if let Err(error) = toggle(&target) {
                eprintln!("workbench title zoom failed: {error}");
            }
        }
        // Swallow the second down and up so AppKit cannot zoom a second time.
        std::ptr::null_mut()
    });
    // SAFETY: callback returns its input event or null; token retained until removal.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDown | NSEventMask::LeftMouseUp,
            &handler,
        )
    }
    .ok_or_else(|| std::io::Error::other("Cannot install title-bar double-click monitor"))?;
    STATE.with(|state| state.borrow_mut().monitor = Some(monitor));
    Ok(())
}
pub fn remove() {
    let monitor = STATE.with(|state| state.borrow_mut().monitor.take());
    if let Some(monitor) = monitor {
        // SAFETY: token comes from addLocalMonitor above and is removed only once.
        unsafe {
            NSEvent::removeMonitor(&monitor);
        }
    }
}
