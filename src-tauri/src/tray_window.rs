/// A visible window may still be minimized or behind another application.
/// Only a confirmed foreground window should hide on a tray click.
pub fn should_hide(visible: bool, minimized: bool, focused: bool) -> bool {
    visible && !minimized && focused
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_background_window_is_recalled_then_foreground_click_hides() {
        assert!(!should_hide(true, false, false));
        assert!(should_hide(true, false, true));
    }

    #[test]
    fn minimized_window_is_restored_even_if_focus_is_stale() {
        assert!(!should_hide(true, true, false));
        assert!(!should_hide(true, true, true));
    }

    #[test]
    fn hidden_window_is_shown_even_if_focus_is_stale() {
        assert!(!should_hide(false, false, false));
        assert!(!should_hide(false, false, true));
    }
}
