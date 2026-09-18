//! Native fullscreen transitions. Call only on the window's UI thread so that
//! restoring, entering fullscreen and restoring maximization cannot interleave.

pub fn set_fullscreen(window: &tauri::WebviewWindow, fullscreen: bool) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::{cell::RefCell, collections::HashMap};
        thread_local! {
            static STATES: RefCell<HashMap<String, WindowsFullscreenState>> = RefCell::default();
        }
        STATES.with(|states| {
            let mut states = states.borrow_mut();
            let state = states.entry(window.label().to_owned()).or_default();
            state.set(window, fullscreen)
        })
    }
    #[cfg(not(target_os = "windows"))]
    window.set_fullscreen(fullscreen)
}

#[cfg(any(target_os = "windows", test))]
trait FullscreenWindow {
    type Error;
    fn is_fullscreen(&self) -> Result<bool, Self::Error>;
    fn is_maximized(&self) -> Result<bool, Self::Error>;
    fn unmaximize(&self) -> Result<(), Self::Error>;
    fn maximize(&self) -> Result<(), Self::Error>;
    fn set_fullscreen(&self, fullscreen: bool) -> Result<(), Self::Error>;
}

#[cfg(any(target_os = "windows", test))]
impl FullscreenWindow for tauri::WebviewWindow {
    type Error = tauri::Error;
    fn is_fullscreen(&self) -> tauri::Result<bool> {
        self.is_fullscreen()
    }
    fn is_maximized(&self) -> tauri::Result<bool> {
        self.is_maximized()
    }
    fn unmaximize(&self) -> tauri::Result<()> {
        self.unmaximize()
    }
    fn maximize(&self) -> tauri::Result<()> {
        self.maximize()
    }
    fn set_fullscreen(&self, fullscreen: bool) -> tauri::Result<()> {
        self.set_fullscreen(fullscreen)
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Default)]
struct WindowsFullscreenState {
    restore_maximized: bool,
}

#[cfg(any(target_os = "windows", test))]
impl WindowsFullscreenState {
    fn set<W: FullscreenWindow>(&mut self, window: &W, fullscreen: bool) -> Result<(), W::Error> {
        if window.is_fullscreen()? != fullscreen {
            if fullscreen {
                // Tao 0.35's WM_NCCALCSIZE clamps maximized frameless windows to
                // rcWork even in fullscreen, leaving the taskbar area black.
                // Clear maximization before Tao saves the window placement and
                // calculates the fullscreen client rect; restore it on exit.
                let maximized = window.is_maximized()?;
                if maximized {
                    window.unmaximize()?;
                }
                self.restore_maximized = maximized;
                if let Err(error) = window.set_fullscreen(true) {
                    if maximized && window.maximize().is_ok() {
                        self.restore_maximized = false;
                    }
                    return Err(error);
                }
            } else {
                window.set_fullscreen(false)?;
            }
        }
        if !fullscreen && self.restore_maximized {
            window.maximize()?;
            self.restore_maximized = false;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct Window {
        fullscreen: Cell<bool>,
        maximized: Cell<bool>,
        fail_fullscreen: Cell<bool>,
        fail_maximize: Cell<bool>,
    }

    impl FullscreenWindow for Window {
        type Error = &'static str;
        fn is_fullscreen(&self) -> Result<bool, Self::Error> {
            Ok(self.fullscreen.get())
        }
        fn is_maximized(&self) -> Result<bool, Self::Error> {
            Ok(self.maximized.get())
        }
        fn unmaximize(&self) -> Result<(), Self::Error> {
            self.maximized.set(false);
            Ok(())
        }
        fn maximize(&self) -> Result<(), Self::Error> {
            assert!(
                !self.fullscreen.get(),
                "must exit fullscreen before maximizing"
            );
            if self.fail_maximize.replace(false) {
                return Err("maximize failed");
            }
            self.maximized.set(true);
            Ok(())
        }
        fn set_fullscreen(&self, fullscreen: bool) -> Result<(), Self::Error> {
            assert!(
                !self.maximized.get(),
                "maximized fullscreen would clip to rcWork"
            );
            if self.fail_fullscreen.replace(false) {
                return Err("fullscreen failed");
            }
            self.fullscreen.set(fullscreen);
            Ok(())
        }
    }

    #[test]
    fn maximized_fullscreen_round_trip_and_repeated_requests() {
        let window = Window::default();
        window.maximized.set(true);
        let mut state = WindowsFullscreenState::default();
        for _ in 0..3 {
            state.set(&window, true).unwrap();
            state.set(&window, true).unwrap();
            assert!(window.fullscreen.get());
            assert!(!window.maximized.get());
            state.set(&window, false).unwrap();
            state.set(&window, false).unwrap();
            assert!(!window.fullscreen.get());
            assert!(window.maximized.get());
        }
        window.unmaximize().unwrap();
        state.set(&window, true).unwrap();
        state.set(&window, false).unwrap();
        assert!(
            !window.maximized.get(),
            "must not reuse previous maximized state"
        );
    }

    #[test]
    fn failed_entry_restores_maximization() {
        let window = Window::default();
        window.maximized.set(true);
        window.fail_fullscreen.set(true);
        let mut state = WindowsFullscreenState::default();
        assert!(state.set(&window, true).is_err());
        assert!(window.maximized.get());
        assert!(!window.fullscreen.get());
        state.set(&window, true).unwrap();
        assert!(window.fullscreen.get());
    }

    #[test]
    fn failed_exit_keeps_restore_state_for_retry() {
        let window = Window::default();
        window.maximized.set(true);
        let mut state = WindowsFullscreenState::default();
        state.set(&window, true).unwrap();
        window.fail_fullscreen.set(true);
        assert!(state.set(&window, false).is_err());
        assert!(window.fullscreen.get());
        window.fail_maximize.set(true);
        assert!(state.set(&window, false).is_err());
        assert!(!window.fullscreen.get());
        state.set(&window, false).unwrap();
        assert!(window.maximized.get());
    }
}
