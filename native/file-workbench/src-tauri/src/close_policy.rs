use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct ClosePolicy {
    ready: AtomicBool,
    confirmed: AtomicBool,
    hide_after_fullscreen: AtomicBool,
}
impl ClosePolicy {
    pub fn defer_hide(&self) {
        self.hide_after_fullscreen.store(true, Ordering::SeqCst);
    }
    pub fn take_deferred_hide(&self) -> bool {
        self.hide_after_fullscreen.swap(false, Ordering::SeqCst)
    }
    pub fn ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }
    pub fn intercept(&self) -> bool {
        self.ready.load(Ordering::SeqCst) && !self.confirmed.load(Ordering::SeqCst)
    }
    pub fn confirm(&self) -> bool {
        !self.confirmed.swap(true, Ordering::SeqCst)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fullscreen_hide_is_consumed_once_without_authorizing_exit() {
        let policy = ClosePolicy::default();
        policy.ready();
        assert!(!policy.take_deferred_hide());
        policy.defer_hide();
        assert!(policy.take_deferred_hide());
        assert!(!policy.take_deferred_hide());
        assert!(policy.intercept());
    }
    #[test]
    fn loading_can_close_but_editor_owned_lifetime_requires_confirmation() {
        let policy = ClosePolicy::default();
        assert!(!policy.intercept());
        policy.ready();
        assert!(policy.intercept());
        // Repeated requests or cancellation cannot silently authorize exit.
        assert!(policy.intercept());
        assert!(policy.confirm());
        assert!(!policy.intercept());
        assert!(!policy.confirm());
    }
}

/// A visible background window must be recalled, not hidden on the first click.
pub fn should_hide(visible: bool, minimized: bool, focused: bool) -> bool {
    visible && !minimized && focused
}
#[cfg(test)]
mod tray_tests {
    use super::*;
    #[test]
    fn background_recall_foreground_hide_and_minimized_restore_have_distinct_actions() {
        assert!(!should_hide(true, false, false)); // Other application is in front: recall.
        assert!(should_hide(true, false, true)); // After recall: next click hides.
        assert!(!should_hide(false, false, false)); // Hidden: next click recalls.
        assert!(!should_hide(true, true, true)); // Minimized wins over stale focus.
    }
}
