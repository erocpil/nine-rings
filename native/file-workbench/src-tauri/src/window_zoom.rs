/// Own the normal frame instead of relying on AppKit's mutable standard frame.
#[derive(Default)]
pub struct ZoomRestore<T> {
    normal: Option<T>,
}
impl<T: Copy> ZoomRestore<T> {
    pub fn toggle(&mut self, current: T, expanded: T) -> T {
        if let Some(normal) = self.normal.take() {
            normal
        } else {
            self.normal = Some(current);
            expanded
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_zoom_restores_the_original_position_and_size() {
        let mut zoom = ZoomRestore::default();
        assert_eq!(
            zoom.toggle((20, 30, 900, 600), (0, 0, 1440, 850)),
            (0, 0, 1440, 850)
        );
        // Work-area and native layout changes must not replace the restore frame.
        assert_eq!(
            zoom.toggle((0, 0, 1438, 848), (0, 0, 1440, 850)),
            (20, 30, 900, 600)
        );
        assert_eq!(
            zoom.toggle((100, 200, 800, 500), (0, 0, 1440, 850)),
            (0, 0, 1440, 850)
        );
        assert_eq!(
            zoom.toggle((0, 0, 1440, 850), (0, 0, 1440, 850)),
            (100, 200, 800, 500)
        );
    }
}
