//! Explicit trusted-window grants. Nine Rings does not install this optional state.
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
#[derive(Default)]
struct Access {
    editors: HashMap<String, HashSet<PathBuf>>,
    mutations: HashMap<u64, Vec<PathBuf>>,
    sequence: u64,
}
#[derive(Default)]
pub struct FileWindowAccess(Arc<Mutex<Access>>);
pub struct FileMutationLease(Arc<Mutex<Access>>, u64);
fn overlaps(left: &Path, right: &Path) -> bool {
    // Conservative on case-sensitive volumes; never miss aliases on the
    // default case-insensitive macOS/Windows filesystems.
    let left = PathBuf::from(left.to_string_lossy().to_lowercase());
    let right = PathBuf::from(right.to_string_lossy().to_lowercase());
    left.starts_with(&right) || right.starts_with(&left)
}
impl FileWindowAccess {
    pub fn grant_editor(&self, label: &str) -> Result<(), String> {
        if !label
            .strip_prefix("workbench-editor-")
            .is_some_and(|suffix| suffix.parse::<u64>().is_ok_and(|number| number > 0))
        {
            return Err("不支持的编辑器窗口身份".into());
        }
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if !state.mutations.is_empty() {
            return Err("文件操作尚未完成，请稍后打开编辑器".into());
        }
        state.editors.entry(label.to_owned()).or_default();
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
                .is_ok_and(|state| state.editors.contains_key(label))
    }
    /// Publish a file reservation before exposing its editor session. Returns
    /// whether the path was newly reserved so a failed open can roll it back.
    pub fn protect_editor_path(&self, label: &str, path: &Path) -> Result<bool, String> {
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if !state.editors.contains_key(label) {
            return Err("编辑器未授权".into());
        }
        if state
            .mutations
            .values()
            .any(|paths| paths.is_empty() || paths.iter().any(|other| overlaps(path, other)))
        {
            return Err("此文件或上级目录正在执行文件操作，请等待完成后打开".into());
        }
        Ok(state
            .editors
            .get_mut(label)
            .unwrap()
            .insert(path.to_owned()))
    }
    pub fn release_editor_path(&self, label: &str, path: &Path) {
        if let Ok(mut state) = self.0.lock() {
            if let Some(paths) = state.editors.get_mut(label) {
                paths.remove(path);
            }
        }
    }
    pub fn begin_paths(
        &self,
        label: &str,
        directory_mutation: bool,
        paths: Vec<PathBuf>,
    ) -> Result<FileMutationLease, String> {
        if paths.is_empty() || paths.iter().any(|path| !path.is_absolute()) {
            return Err("无效的文件保护路径".into());
        }
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if label != "main" && (directory_mutation || !state.editors.contains_key(label)) {
            return Err("此窗口无文件操作权限".into());
        }
        if (directory_mutation || label == "main")
            && state
                .editors
                .values()
                .flatten()
                .any(|file| paths.iter().any(|path| overlaps(file, path)))
        {
            return Err("PATH_IN_USE: 此文件或目录仍在编辑器中打开；请先保存并关闭相关文件".into());
        }
        if state.mutations.values().any(|other| {
            other.is_empty()
                || other
                    .iter()
                    .any(|left| paths.iter().any(|right| overlaps(left, right)))
        }) {
            return Err("PATH_BUSY: 相关路径正在写入，请等待当前操作完成".into());
        }
        state.sequence += 1;
        let id = state.sequence;
        state.mutations.insert(id, paths);
        Ok(FileMutationLease(self.0.clone(), id))
    }
    pub fn begin(
        &self,
        label: &str,
        directory_mutation: bool,
    ) -> Result<FileMutationLease, String> {
        let mut state = self.0.lock().map_err(|_| "文件窗口状态不可用")?;
        if label != "main" && (directory_mutation || !state.editors.contains_key(label)) {
            return Err("此窗口无文件操作权限".into());
        }
        if (label == "main" && !state.editors.is_empty())
            || (directory_mutation && !state.mutations.is_empty())
        {
            return Err(
                "编辑器或文件写入仍在使用授权目录；请先保存并关闭编辑器，再执行目录操作或撤销授权"
                    .into(),
            );
        }
        state.sequence += 1;
        let id = state.sequence;
        state.mutations.insert(id, Vec::new());
        Ok(FileMutationLease(self.0.clone(), id))
    }
}
impl Drop for FileMutationLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            state.mutations.remove(&self.1);
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

#[cfg(test)]
mod scoped_tests {
    use super::*;
    fn path(value: &str) -> PathBuf {
        std::env::temp_dir().join("workbench-path-test").join(value)
    }
    #[test]
    fn unrelated_operations_continue_but_open_files_and_parents_are_protected() {
        let access = FileWindowAccess::default();
        access.grant_editor("workbench-editor-1").unwrap();
        access
            .protect_editor_path("workbench-editor-1", &path("code/main.c"))
            .unwrap();
        assert!(access
            .begin_paths("main", true, vec![path("other/a.c"), path("target/a.c")])
            .is_ok());
        for blocked in ["code", "code/main.c", "CODE/MAIN.C"] {
            assert!(access
                .begin_paths("main", true, vec![path(blocked)])
                .err()
                .unwrap()
                .contains("PATH_IN_USE"));
        }
        assert!(access
            .begin_paths("main", false, vec![path("code/main.c")])
            .is_err());
        assert!(access
            .begin_paths("workbench-editor-1", true, vec![path("other")])
            .is_err());
        access.release_editor_path("workbench-editor-1", &path("code/main.c"));
        assert!(access.begin_paths("main", true, vec![path("code")]).is_ok());
    }
    #[test]
    fn reservation_and_directory_leases_cannot_race() {
        let access = FileWindowAccess::default();
        access.grant_editor("workbench-editor-1").unwrap();
        let mutation = access
            .begin_paths("main", true, vec![path("dest")])
            .unwrap();
        assert!(access
            .protect_editor_path("workbench-editor-1", &path("dest/a.c"))
            .is_err());
        assert!(access
            .protect_editor_path("workbench-editor-1", &path("other/b.c"))
            .unwrap());
        assert!(access
            .begin_paths("main", true, vec![path("dest/a.c")])
            .is_err());
        assert!(access
            .begin_paths("main", true, vec![path("sibling")])
            .is_ok());
        drop(mutation);
        assert!(access
            .protect_editor_path("workbench-editor-1", &path("dest/a.c"))
            .unwrap());
    }
    #[test]
    fn save_lease_survives_window_revocation_and_excludes_overlapping_writes() {
        let access = FileWindowAccess::default();
        access.grant_editor("workbench-editor-1").unwrap();
        let save = access
            .begin_paths("workbench-editor-1", false, vec![path("file.c")])
            .unwrap();
        assert!(access
            .begin_paths("workbench-editor-1", false, vec![path("FILE.C")])
            .is_err());
        access.revoke_editor("workbench-editor-1");
        assert!(access
            .begin_paths("main", true, vec![path("file.c")])
            .is_err());
        assert!(access
            .begin_paths("main", true, vec![path("other.c")])
            .is_ok());
        drop(save);
        assert!(access
            .begin_paths("main", true, vec![path("file.c")])
            .is_ok());
        assert!(access
            .begin_paths("workbench-editor-1", false, vec![path("file.c")])
            .is_err());
        assert!(access.begin_paths("main", true, Vec::new()).is_err());
        assert!(access
            .begin_paths("main", true, vec![PathBuf::from("relative")])
            .is_err());
    }
}
