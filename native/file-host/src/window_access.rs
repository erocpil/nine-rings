//! Explicit trusted-window grants. Nine Rings does not install this optional state.
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
#[derive(Default)]
struct Access {
    editors: HashSet<String>,
    mutations: usize,
}
#[derive(Default)]
pub struct FileWindowAccess(Arc<Mutex<Access>>);
pub struct FileMutationLease(Arc<Mutex<Access>>);
impl FileWindowAccess {
    pub fn grant_editor(&self, label: &str) -> Result<(), String> {
        if !label
            .strip_prefix("workbench-editor-")
            .is_some_and(|suffix| suffix.parse::<u64>().is_ok_and(|number| number > 0))
        {
            return Err("不支持的编辑器窗口身份".into());
        }
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if state.mutations != 0 {
            return Err("文件操作尚未完成，请稍后打开编辑器".into());
        }
        state.editors.insert(label.to_owned());
        Ok(())
    }
    pub fn revoke_editor(&self, label: &str) {
        if let Ok(mut state) = self.0.lock() {
            state.editors.remove(label);
        }
    }
    pub fn allows(&self, label: &str) -> bool {
        label == "main"
            || self
                .0
                .lock()
                .is_ok_and(|state| state.editors.contains(label))
    }
    pub fn begin(
        &self,
        label: &str,
        directory_mutation: bool,
    ) -> Result<FileMutationLease, String> {
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if label != "main" && (directory_mutation || !state.editors.contains(label)) {
            return Err("此窗口无文件操作权限".into());
        }
        if (label == "main" && !state.editors.is_empty())
            || (directory_mutation && state.mutations != 0)
        {
            return Err(
                "编辑器或文件写入仍在使用授权目录；请先保存并关闭编辑器，再执行目录操作或撤销授权"
                    .into(),
            );
        }
        state.mutations += 1;
        Ok(FileMutationLease(self.0.clone()))
    }
}
impl Drop for FileMutationLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            state.mutations = state.mutations.saturating_sub(1);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grants_are_explicit_and_mutations_cannot_race_editor_creation() {
        let access = FileWindowAccess::default();
        assert!(access.allows("main"));
        assert!(!access.allows("workbench-editor-1"));
        assert!(access.grant_editor("arbitrary").is_err());
        let write = access.begin("main", true).unwrap();
        assert!(access.grant_editor("workbench-editor-1").is_err());
        drop(write);
        access.grant_editor("workbench-editor-1").unwrap();
        assert!(access.allows("workbench-editor-1"));
        assert!(!access.allows("other"));
        assert!(access.begin("main", true).is_err());
        assert!(access.begin("workbench-editor-1", true).is_err());
        let save = access.begin("workbench-editor-1", false).unwrap();
        access.revoke_editor("workbench-editor-1");
        assert!(access.begin("main", true).is_err());
        drop(save);
        assert!(access.begin("main", true).is_ok());
        assert!(access.begin("workbench-editor-1", false).is_err());
    }
    #[test]
    fn a_recreated_editor_does_not_revive_the_old_window_identity() {
        let access = FileWindowAccess::default();
        access.grant_editor("workbench-editor-1").unwrap();
        access.revoke_editor("workbench-editor-1");
        access.grant_editor("workbench-editor-2").unwrap();
        assert!(!access.allows("workbench-editor-1"));
        assert!(access.begin("workbench-editor-1", false).is_err());
        assert!(access.begin("main", false).is_err());
        assert!(access.begin("workbench-editor-2", false).is_ok());
    }
}
