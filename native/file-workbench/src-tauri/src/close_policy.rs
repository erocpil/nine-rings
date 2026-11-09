use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct ClosePolicy {
    ready: AtomicBool,
    confirmed: AtomicBool,
}
impl ClosePolicy {
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
