//! Persist user-open tabs independently of a window's close/quit transaction.
use super::editor_window::EditorFile;
use nine_rings_file_host::local_files::{replace_recovery_file, LocalFiles, RelocationStamp};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Write},
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relocation: Option<Relocation>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relocation {
    pub source: String,
    pub target: EditorFile,
    pub stamp: RelocationStamp,
}
impl Relocation {
    pub fn apply(&self, files: &mut [EditorFile], current: &mut Option<String>) {
        if let Some(file) = files.iter_mut().find(|file| file.id == self.source) {
            *file = self.target.clone();
            if current.as_deref() == Some(&self.source) {
                *current = Some(file.id.clone());
            }
        }
    }
}
pub struct EditorSessionStore {
    path: Option<PathBuf>,
    snapshot: Mutex<Option<Snapshot>>,
    pub restoring: AtomicBool,
}
impl EditorSessionStore {
    pub fn load(path: &Path, notices: &mut Vec<String>) -> Self {
        let (path, snapshot) = match Self::read_snapshot(path) {
            Ok(Ok(snapshot)) => (Some(path.to_owned()), snapshot),
            Ok(Err(issue)) => match Self::quarantine(path) {
                Ok(backup) => {
                    notices.push(format!("{issue}。原记录已保留在 {}", backup.display()));
                    (Some(path.to_owned()), None)
                }
                Err(error) => {
                    notices.push(format!(
                        "{issue}，无法移存原记录（{error}）。本次标签仅在内存中保留。"
                    ));
                    (None, None)
                }
            },
            Err(error) => {
                notices.push(format!(
                    "无法读取标签记录 {}（{error}）。本次标签仅在内存中保留。",
                    path.display()
                ));
                (None, None)
            }
        };
        Self {
            path,
            snapshot: Mutex::new(snapshot),
            restoring: AtomicBool::new(false),
        }
    }
    const MAX_BYTES: usize = 512 * 1024;

    fn read_snapshot(path: &Path) -> io::Result<Result<Option<Snapshot>, String>> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(io::Error::other("标签记录须为普通文件"))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Ok(None)),
            Err(error) => return Err(error),
        }
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Ok(None)),
            Err(error) => return Err(error),
        };
        let mut bytes = Vec::new();
        file.take(Self::MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > Self::MAX_BYTES {
            return Ok(Err("编辑器标签记录过大".into()));
        }
        Ok(serde_json::from_slice::<Snapshot>(&bytes)
            .map_err(|error| format!("编辑器标签记录无法解析（{error}）"))
            .and_then(|value| {
                Self::validate(&value)?;
                Ok(Some(value))
            }))
    }

    fn quarantine(path: &Path) -> io::Result<PathBuf> {
        for index in 1..=1000 {
            let directory = path.with_extension(format!("recovery-{index}"));
            match fs::create_dir(&directory) {
                Ok(()) => {
                    let backup = directory.join("editor-session.json");
                    fs::rename(path, &backup)?;
                    return Ok(backup);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::other("标签恢复目录已满"))
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
        if let Some(relocation) = &value.relocation {
            let source = value
                .files
                .iter()
                .find(|file| file.id == relocation.source)
                .ok_or("编辑器迁移来源无效")?;
            if ids.contains(&relocation.target.id)
                || !source.file["bufferId"].is_null()
                || !relocation.target.file["bufferId"].is_null()
                || source.file["rootId"] != relocation.target.file["rootId"]
            {
                return Err("编辑器迁移记录无效".into());
            }
            let mut finalized = value.clone();
            finalized.relocation = None;
            relocation.apply(&mut finalized.files, &mut finalized.current);
            Self::validate(&finalized)?;
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
    pub fn recover_relocation(
        &mut self,
        library: &LocalFiles,
        notices: &mut Vec<String>,
    ) -> Result<(), String> {
        let Some(mut saved) = self.read()? else {
            return Ok(());
        };
        let Some(journal) = saved.relocation.take() else {
            return Ok(());
        };
        let matches = |file: &EditorFile| {
            let root = file.file["rootId"].as_str().unwrap_or_default();
            let node = file.file["node"]["id"].as_str().unwrap_or_default();
            library
                .editor_relocation_stamp(root, node, Path::new(&file.id))
                .is_ok_and(|stamp| stamp.same_file(&journal.stamp))
        };
        let source_matches = saved
            .files
            .iter()
            .find(|file| file.id == journal.source)
            .is_some_and(matches);
        match (source_matches, matches(&journal.target)) {
            (false, true) => journal.apply(&mut saved.files, &mut saved.current),
            (true, false) => {}
            _ => {
                let issue = "无法根据两端文件身份确认中断的移动。可能受影响的标签已跳过，请核对原文件和目标。";
                if let Some(path) = &self.path {
                    match Self::quarantine(path) {
                        Ok(backup) => {
                            notices.push(format!("{issue} 原记录位于 {}", backup.display()))
                        }
                        Err(error) => {
                            notices.push(format!(
                                "{issue} 原记录保持原位（{error}），本次标签仅保留在内存。"
                            ));
                            self.path = None;
                        }
                    }
                }
                saved.files.retain(|file| file.id != journal.source);
                if saved.current.as_deref() == Some(&journal.source) {
                    saved.current = saved.files.last().map(|file| file.id.clone());
                }
            }
        }
        if let Err(error) = self.commit_value(saved.clone()) {
            notices.push(format!(
                "恢复结果无法写入（{error}），本次标签仅保留在内存。"
            ));
            self.path = None;
            self.commit_value(saved)?;
        }
        Ok(())
    }
    pub fn prepare_relocation(
        &self,
        files: &[EditorFile],
        current: Option<&str>,
        relocation: Relocation,
    ) -> Result<(), String> {
        let path = self
            .path
            .as_deref()
            .ok_or("标签清单当前无法持久保存，请关闭此标签后再移动")?;
        if self.read()?.is_some_and(|saved| saved.relocation.is_some()) {
            return Err("上一次移动仍待核对".into());
        }
        self.commit(files, current, Some(relocation))?;
        nine_rings_file_host::local_files::sync_relocation_paths(path, path)
    }
    pub fn save(&self, files: &[EditorFile], current: Option<&str>) -> Result<(), String> {
        if self.restoring.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.commit(files, current, None)
    }
    // Bootstrap must write the initial (including empty) manifest even while
    // partial UI publications are intentionally excluded from persistence.
    pub fn initialize(&self, files: &[EditorFile], current: Option<&str>) -> Result<(), String> {
        self.commit(files, current, None)
    }
    fn commit(
        &self,
        files: &[EditorFile],
        current: Option<&str>,
        relocation: Option<Relocation>,
    ) -> Result<(), String> {
        let mut retained = files.to_vec();
        for file in &mut retained {
            if let Some(value) = file.file.as_object_mut() {
                value.remove("location");
                value.remove("headingFragment");
            }
        }
        let value = Snapshot {
            version: 1,
            files: retained,
            current: current.map(str::to_owned),
            relocation,
        };
        self.commit_value(value)
    }
    fn commit_value(&self, value: Snapshot) -> Result<(), String> {
        Self::validate(&value)?;
        let mut state = self.snapshot.lock().map_err(|_| "编辑器标签存储不可用")?;
        if let Some(path) = &self.path {
            let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
            if bytes.len() > Self::MAX_BYTES {
                return Err("编辑器标签记录超过 512 KiB".into());
            }
            let temp = path.with_extension("tmp");
            let mut output = fs::File::create(&temp).map_err(|e| e.to_string())?;
            output
                .write_all(&bytes)
                .and_then(|_| output.sync_all())
                .map_err(|e| e.to_string())?;
            replace_recovery_file(&temp, path)?;
        }
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
            EditorSessionStore::load(&self.0.join("session.json"), &mut Vec::new())
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
    fn corrupt_manifest_is_preserved_and_a_fresh_manifest_can_be_saved() {
        let fixture = Fixture::new();
        let path = fixture.0.join("session.json");
        let mut notices = Vec::new();
        fs::write(&path, b"{truncated").unwrap();
        let store = EditorSessionStore::load(&path, &mut notices);
        assert_eq!(notices.len(), 1);
        assert!(store.read().unwrap().is_none());
        assert_eq!(
            fs::read(fixture.0.join("session.recovery-1/editor-session.json")).unwrap(),
            b"{truncated"
        );
        store.initialize(&[], None).unwrap();
        assert!(fixture.store().read().unwrap().unwrap().files.is_empty());
    }
    #[test]
    fn process_restart_resolves_open_relocation_from_the_original_file_identity() {
        for published in [false, true] {
            let fixture = Fixture::new();
            let root = fixture.0.canonicalize().unwrap();
            fs::write(
                root.join("local-file-roots.json"),
                serde_json::to_vec(&serde_json::json!([{ "id": "root", "path": root }])).unwrap(),
            )
            .unwrap();
            let library = LocalFiles::load(&root);
            let (source_path, target_path) = (root.join("source.c"), root.join("target.c"));
            fs::write(&source_path, "my edit").unwrap();
            let stamp = library
                .editor_relocation_stamp("root", "source.c", &source_path)
                .unwrap();
            let entry = |name: &str| {
                let mut value = file(name);
                value.id = root.join(name).to_str().unwrap().to_owned();
                value
            };
            let (source, target) = (entry("source.c"), entry("target.c"));
            fixture
                .store()
                .prepare_relocation(
                    std::slice::from_ref(&source),
                    Some(&source.id),
                    Relocation {
                        source: source.id.clone(),
                        target: target.clone(),
                        stamp: stamp.clone(),
                    },
                )
                .unwrap();
            if published {
                library
                    .publish_editor_relocation(
                        "root",
                        "source.c",
                        "target.c",
                        &source_path,
                        &target_path,
                        &stamp,
                    )
                    .unwrap();
            } else {
                fs::write(&target_path, "other process").unwrap();
                assert!(library
                    .publish_editor_relocation(
                        "root",
                        "source.c",
                        "target.c",
                        &source_path,
                        &target_path,
                        &stamp
                    )
                    .is_err());
                assert_eq!(fs::read_to_string(&target_path).unwrap(), "other process");
            }
            let mut notices = Vec::new();
            fixture
                .store()
                .recover_relocation(&library, &mut notices)
                .unwrap();
            assert!(notices.is_empty());
            let restored = fixture.store().read().unwrap().unwrap();
            let expected = if published { target.id } else { source.id };
            assert_eq!(restored.files[0].id, expected);
            assert_eq!(restored.current.as_deref(), Some(expected.as_str()));
            assert!(restored.relocation.is_none());
        }
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
