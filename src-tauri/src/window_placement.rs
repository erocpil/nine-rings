/// Keep zoom's restore frame separate from the frame saved for a fullscreen
/// round trip. AppKit/Tao can otherwise overwrite the former during exit.
#[derive(Default)]
pub struct WindowPlacement<T> {
    normal: Option<T>,
    fullscreen: Option<T>,
}

impl<T: Copy> WindowPlacement<T> {
    pub fn toggle_zoom(&mut self, current: T, maximized: T, is_maximized: bool) -> T {
        // Our saved normal frame is the authoritative zoom state. AppKit can
        // adjust a zoomed frame later (Dock/menu-bar/work-area changes), so an
        // exact comparison with the current visibleFrame eventually becomes
        // false and used to overwrite the only restore frame.
        if let Some(normal) = self.normal.take() {
            return normal;
        }
        if is_maximized {
            return current;
        }
        self.normal = Some(current);
        maximized
    }

    pub fn begin_fullscreen(&mut self, current: T) {
        // An opposite request can be queued during the Space animation.
        // Never replace the original frame with an intermediate fullscreen one.
        self.fullscreen.get_or_insert(current);
    }

    pub fn finish_fullscreen(&mut self) -> Option<T> {
        self.fullscreen.take()
    }

    pub fn transitioning(&self) -> bool {
        self.fullscreen.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_fullscreen_exit_unzoom_preserves_the_original_frame() {
        let mut frames = WindowPlacement::default();
        for _ in 0..3 {
            assert_eq!(frames.toggle_zoom(100, 500, false), 500);
            frames.begin_fullscreen(500);
            frames.begin_fullscreen(900);
            assert!(frames.transitioning());
            assert_eq!(frames.finish_fullscreen(), Some(500));
            assert!(!frames.transitioning());
            assert_eq!(frames.toggle_zoom(500, 500, true), 100);
        }
    }

    #[test]
    fn ordinary_fullscreen_and_manual_resize_do_not_reuse_stale_geometry() {
        let mut frames = WindowPlacement::default();
        frames.begin_fullscreen(100);
        assert_eq!(frames.finish_fullscreen(), Some(100));
        assert_eq!(frames.finish_fullscreen(), None);
        frames.toggle_zoom(100, 500, false);
        // AppKit may change the zoomed frame after a work-area change. The
        // original normal frame remains the target of the next double-click.
        assert_eq!(frames.toggle_zoom(200, 500, false), 100);
        assert_eq!(frames.toggle_zoom(200, 500, false), 500);
        assert_eq!(frames.toggle_zoom(500, 500, true), 200);
    }
}
