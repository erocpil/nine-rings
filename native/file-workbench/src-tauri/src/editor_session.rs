//! Persist user-open tabs independently of a window's close/quit transaction.
use super::editor_window::EditorFile;
use nine_rings_file_host::local_files::replace_recovery_file;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u8,
    pub files: Vec<EditorFile>,
    pub current: Option<String>,
}
pub struct EditorSessionStore {
    path: PathBuf,
    snapshot: Mutex<Option<Snapshot>>,
    pub restoring: AtomicBool,
}
impl EditorSessionStore {
    pub fn load(path: &Path) -> Result<Self, String> {
        let snapshot = if path.exists() {
            if fs::metadata(path).map_err(|e| e.to_string())?.len() > 512 * 1024 {
                return Err("编辑器标签记录过大，未覆盖原记录".into());
            }
            let value: Snapshot =
                serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("编辑器标签记录读取失败，未覆盖原记录：{e}"))?;
            Self::validate(&value)?;
            Some(value)
        } else {
            None
        };
        Ok(Self {
            path: path.to_owned(),
            snapshot: Mutex::new(snapshot),
            restoring: AtomicBool::new(false),
        })
    }
    fn validate(value: &Snapshot) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        if value.version != 1
            || value.files.len() > 32
            || value
                .current
                .as_ref()
                .is_some_and(|id| !value.files.iter().any(|file| &file.id == id))
        {
            return Err("编辑器标签记录无效".into());
        }
        for file in &value.files {
            if !ids.insert(&file.id)
                || file.id.len() > 8192
                || (!Path::new(&file.id).is_absolute()
                    && !file.id.starts_with("workbench-buffer:buffer-"))
                || file.file["rootId"].as_str().is_none_or(str::is_empty)
                || file.file["node"]["id"].as_str().is_none_or(str::is_empty)
                || file.file["node"]["name"].as_str().is_none_or(str::is_empty)
            {
                return Err("编辑器标签身份无效".into());
            }
        }
        Ok(())
    }
    pub fn read(&self) -> Result<Option<Snapshot>, String> {
        Ok(self
            .snapshot
            .lock()
            .map_err(|_| "编辑器标签存储不可用")?
            .clone())
    }
    pub fn save(&self, files: &[EditorFile], current: Option<&str>) -> Result<(), String> {
        if self.restoring.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.commit(files, current)
    }
    // Bootstrap must write the initial (including empty) manifest even while
    // partial UI publications are intentionally excluded from persistence.
    pub fn initialize(&self, files: &[EditorFile], current: Option<&str>) -> Result<(), String> {
        self.commit(files, current)
    }
    fn commit(&self, files: &[EditorFile], current: Option<&str>) -> Result<(), String> {
        let mut retained = files.to_vec();
        for file in &mut retained {
            if let Some(value) = file.file.as_object_mut() {
                value.remove("location");
            }
        }
        let value = Snapshot {
            version: 1,
            files: retained,
            current: current.map(str::to_owned),
        };
        Self::validate(&value)?;
        let mut state = self.snapshot.lock().map_err(|_| "编辑器标签存储不可用")?;
        let temp = self.path.with_extension("tmp");
        let mut output = fs::File::create(&temp).map_err(|e| e.to_string())?;
        output
            .write_all(&serde_json::to_vec(&value).map_err(|e| e.to_string())?)
            .and_then(|_| output.sync_all())
            .map_err(|e| e.to_string())?;
        replace_recovery_file(&temp, &self.path)?;
        *state = Some(value);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            loop {
                let dir = std::env::temp_dir().join(format!(
                    "workbench-session-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed),
                ));
                match fs::create_dir(&dir) {
                    Ok(()) => return Self(dir),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("cannot create editor session fixture: {error}"),
                }
            }
        }
        fn store(&self) -> EditorSessionStore {
            EditorSessionStore::load(&self.0.join("session.json")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn file(name: &str) -> EditorFile {
        EditorFile {
            id: std::env::temp_dir().join(name).to_string_lossy().into(),
            file: serde_json::json!({ "rootId":"root", "node":{"id":name,"name":name}, "location":{"from":10,"to":12,"revision":"old-search"} }),
            open_revision: 1,
        }
    }
    #[test]
    fn initial_empty_manifest_is_committed_during_bootstrap() {
        let fixture = Fixture::new();
        let store = fixture.store();
        store.restoring.store(true, Ordering::SeqCst);
        store.initialize(&[], None).unwrap();
        assert!(fixture.store().read().unwrap().unwrap().files.is_empty());
    }
    #[test]
    fn process_restart_restores_tab_order_and_active_file_without_replaying_search() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let files = vec![file("b.c"), file("a.md")];
        store.save(&files, Some(&files[0].id)).unwrap();
        drop(store);
        let restored = fixture.store().read().unwrap().unwrap();
        assert_eq!(restored.files.len(), 2);
        assert_eq!(restored.files[0].id, files[0].id);
        assert_eq!(restored.current, Some(files[0].id.clone()));
        assert!(restored.files[0].file["location"].is_null());
    }
    #[test]
    fn explicit_close_and_empty_session_persist_and_do_not_trigger_legacy_migration() {
        let fixture = Fixture::new();
        let store = fixture.store();
        assert!(store.read().unwrap().is_none());
        let files = vec![file("b.c"), file("a.md")];
        store.save(&files, Some(&files[0].id)).unwrap();
        store.save(&files[1..], Some(&files[1].id)).unwrap();
        assert_eq!(fixture.store().read().unwrap().unwrap().files.len(), 1);
        store.save(&[], None).unwrap();
        assert!(fixture.store().read().unwrap().unwrap().files.is_empty());
    }
    #[test]
    fn invalid_or_failed_publication_keeps_last_confirmed_manifest() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let file = file("a.c");
        store
            .save(std::slice::from_ref(&file), Some(&file.id))
            .unwrap();
        assert!(store
            .save(&[file.clone(), file.clone()], Some(&file.id))
            .is_err());
        assert!(store
            .save(std::slice::from_ref(&file), Some("missing"))
            .is_err());
        fs::create_dir(fixture.0.join("session.tmp")).unwrap();
        assert!(store.save(&[], None).is_err());
        assert_eq!(fixture.store().read().unwrap().unwrap().files.len(), 1);
    }
    #[test]
    fn restore_does_not_replace_manifest_with_a_partial_tab_list() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let files = vec![file("a.c"), file("b.c")];
        store.save(&files, Some(&files[0].id)).unwrap();
        store.restoring.store(true, Ordering::SeqCst);
        store.save(&files[..1], Some(&files[0].id)).unwrap();
        assert_eq!(fixture.store().read().unwrap().unwrap().files.len(), 2);
    }
}
