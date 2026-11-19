use std::sync::Mutex;
#[derive(Default)]
pub struct WindowActivation(Mutex<Option<String>>);
impl WindowActivation {
    pub fn record(&self, label: &str) {
        if label == "main" || label.starts_with("workbench-editor-") {
            if let Ok(mut value) = self.0.lock() {
                *value = Some(label.to_owned());
            }
        }
    }
    pub fn current(&self) -> String {
        self.0
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_else(|| "main".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activation_preserves_last_focused_editor_until_browser_is_explicitly_selected() {
        let value = WindowActivation::default();
        assert_eq!(value.current(), "main");
        value.record("workbench-editor-1");
        value.record("unknown");
        assert_eq!(value.current(), "workbench-editor-1");
        value.record("main");
        assert_eq!(value.current(), "main");
    }
}
