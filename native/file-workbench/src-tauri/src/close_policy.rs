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
