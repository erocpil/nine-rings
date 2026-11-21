//! Durable, path-free editor documents. A save dialog grants one exact file;
//! its parent is never added to the directory browser's authorized roots.
use nine_rings_file_host::{local_files, window_access::FileWindowAccess};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
static NEXT: AtomicU64 = AtomicU64::new(0);
const MAX_BYTES: usize = 4 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferRecord {
    pub id: String,
    pub name: String,
    pub source: String,
    pub version: u64,
    pub path: Option<PathBuf>,
    pub base_source: String,
    pub base_revision: String,
    pub created_at: u128,
    pub bom: bool,
    pub line_ending: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferBase {
    source: String,
    revision: String,
    bom: bool,
    line_ending: String,
}
pub struct BufferDocuments {
    directory: PathBuf,
    records: Mutex<HashMap<String, BufferRecord>>,
    saving: Arc<Mutex<HashSet<String>>>,
}
pub(crate) struct Saving(Arc<Mutex<HashSet<String>>>, String);
impl Drop for Saving {
    fn drop(&mut self) {
        if let Ok(mut values) = self.0.lock() {
            values.remove(&self.1);
        }
    }
}
fn validate(value: &BufferRecord) -> Result<(), String> {
    if !value.id.starts_with("buffer-")
        || !value
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || value.id.len() > 100
        || value.source.len() > MAX_BYTES
        || value.base_source.len() > MAX_BYTES
        || value.name.trim().is_empty()
        || value.path.as_ref().is_some_and(|path| !path.is_absolute())
        || value.version == 0
    {
        return Err("未保存文档记录无效，请保留数据并检查本机存储".into());
    }
    Ok(())
}
impl BufferRecord {
    pub fn session(&self) -> super::editor_window::EditorFile {
        super::editor_window::EditorFile {
            id: format!("workbench-buffer:{}", self.id),
            open_revision: 1,
            file: json!({ "rootId": "workbench-buffer", "rootName": "编辑文档", "node": { "id": self.id, "name": self.name, "directory": false, "size": self.source.len() }, "bufferId": self.id, "bufferPath": self.path, "untitled": self.path.is_none() }),
        }
    }
}
impl BufferDocuments {
    pub fn load(directory: &Path, notices: &mut Vec<String>) -> Self {
        let mut records = HashMap::new();
        match fs::create_dir_all(directory).and_then(|()| fs::read_dir(directory)) {
            Ok(entries) => {
                for entry in entries {
                    let path = match entry {
                        Ok(entry) => entry.path(),
                        Err(error) => {
                            notices.push(format!(
                                "无法枚举草稿目录 {}（{error}）。",
                                directory.display()
                            ));
                            continue;
                        }
                    };
                    if path.extension().and_then(|value| value.to_str()) != Some("json") {
                        continue;
                    }
                    match Self::load_record(&path) {
                        Ok(value) => {
                            records.insert(value.id.clone(), value);
                        }
                        Err(error) => notices.push(format!(
                            "无法恢复草稿 {}（{error}）。原记录已保留。",
                            path.display()
                        )),
                    }
                }
            }
            Err(error) => {
                notices.push(format!(
                    "草稿目录 {} 暂不可用（{error}）。",
                    directory.display()
                ));
            }
        }
        Self {
            directory: directory.to_owned(),
            records: Mutex::new(records),
            saving: Arc::new(Mutex::new(HashSet::new())),
        }
    }
    fn load_record(path: &Path) -> Result<BufferRecord, String> {
        if !fs::symlink_metadata(path)
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("草稿记录须为普通文件".into());
        }
        let limit = MAX_BYTES * 13;
        let mut bytes = Vec::new();
        fs::File::open(path)
            .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
            .map_err(|error| error.to_string())?;
        if bytes.len() > limit {
            return Err("未保存文档记录过大".into());
        }
        let value: BufferRecord =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        validate(&value)?;
        if path.file_stem().and_then(|value| value.to_str()) != Some(value.id.as_str()) {
            return Err("未保存文档身份不符".into());
        }
        Ok(value)
    }
    pub(crate) fn begin_save(&self, id: &str) -> Result<Saving, String> {
        let mut values = self.saving.lock().map_err(|_| "保存状态不可用")?;
        if !values.insert(id.to_owned()) {
            return Err("文件正在保存，请等待完成".into());
        }
        Ok(Saving(self.saving.clone(), id.to_owned()))
    }
    pub(crate) fn is_saving(&self) -> Result<bool, String> {
        Ok(!self.saving.lock().map_err(|_| "保存状态不可用")?.is_empty())
    }
    pub fn list(&self) -> Result<Vec<BufferRecord>, String> {
        let mut values = self
            .records
            .lock()
            .map_err(|_| "未保存文档不可用")?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        values.sort_by_key(|value| value.created_at);
        Ok(values)
    }
    pub fn get(&self, id: &str) -> Result<BufferRecord, String> {
        self.records
            .lock()
            .map_err(|_| "未保存文档不可用")?
            .get(id)
            .cloned()
            .ok_or("未保存文档不存在".into())
    }
    fn persist(&self, value: &BufferRecord) -> Result<(), String> {
        validate(value)?;
        let target = self.directory.join(format!("{}.json", value.id));
        let temp = self.directory.join(format!("{}.tmp", value.id));
        let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        let mut file = fs::File::create(&temp).map_err(|error| error.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        // This is application-owned recovery data, never a user file.
        local_files::replace_recovery_file(&temp, &target)
    }
    pub fn create(&self) -> Result<BufferRecord, String> {
        let mut records = self.records.lock().map_err(|_| "未保存文档不可用")?;
        if records.len() >= 32 {
            return Err("最多保留32份新建文档，请先保存并关闭或删除不再需要的草稿".into());
        }
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let id = loop {
            let id = format!(
                "buffer-{created_at}-{}",
                NEXT.fetch_add(1, Ordering::SeqCst)
            );
            match fs::symlink_metadata(self.directory.join(format!("{id}.json"))) {
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break id,
                Err(error) => return Err(error.to_string()),
            }
        };
        let mut index = 1;
        while records.values().any(|item| {
            item.name
                == if index == 1 {
                    "未命名".into()
                } else {
                    format!("未命名 {index}")
                }
        }) {
            index += 1;
        }
        let value = BufferRecord {
            id: id.clone(),
            name: if index == 1 {
                "未命名".into()
            } else {
                format!("未命名 {index}")
            },
            source: String::new(),
            version: 1,
            path: None,
            base_source: String::new(),
            base_revision: String::new(),
            created_at,
            bom: false,
            line_ending: "lf".into(),
        };
        self.persist(&value)?;
        records.insert(id, value.clone());
        Ok(value)
    }
    pub fn checkpoint(
        &self,
        id: &str,
        expected: u64,
        source: String,
        base: Option<BufferBase>,
    ) -> Result<BufferRecord, String> {
        if source.len() > MAX_BYTES {
            return Err("文件超过4 MiB，尚未保存到本机".into());
        }
        let busy = self.saving.lock().map_err(|_| "保存状态不可用")?;
        if busy.contains(id) {
            return Err("文件正在保存，请等待完成后再修改草稿".into());
        }
        let mut records = self.records.lock().map_err(|_| "未保存文档不可用")?;
        let old = records.get(id).ok_or("未保存文档不存在")?;
        if old.version != expected {
            return Err("文档版本已变化，请重新打开核对，未覆盖本机草稿".into());
        }
        let mut value = old.clone();
        value.source = source;
        if let Some(base) = base {
            if value.path.is_none() || base.source.len() > MAX_BYTES {
                return Err("磁盘基准无效，未覆盖本机草稿".into());
            }
            value.base_source = base.source;
            value.base_revision = base.revision;
            value.bom = base.bom;
            value.line_ending = base.line_ending;
        }
        value.version += 1;
        self.persist(&value)?;
        records.insert(id.into(), value.clone());
        Ok(value)
    }
    fn committed(&self, id: &str, path: PathBuf, snapshot: &Value) -> Result<BufferRecord, String> {
        let mut records = self.records.lock().map_err(|_| "未保存文档不可用")?;
        let mut value = records.get(id).cloned().ok_or("未保存文档不存在")?;
        value.name = path
            .file_name()
            .ok_or("文件名无效")?
            .to_string_lossy()
            .to_string();
        value.path = Some(path);
        value.source = snapshot["source"].as_str().ok_or("保存结果无效")?.into();
        value.bom = snapshot["bom"].as_bool().unwrap_or(false);
        value.line_ending = snapshot["lineEnding"].as_str().unwrap_or("lf").into();
        value.base_source = value.source.clone();
        value.base_revision = snapshot["revision"].as_str().ok_or("保存结果无效")?.into();
        value.version += 1;
        self.persist(&value)?;
        records.insert(id.into(), value.clone());
        Ok(value)
    }
    pub fn discard(&self, id: &str) -> Result<(), String> {
        let busy = self.saving.lock().map_err(|_| "保存状态不可用")?;
        if busy.contains(id) {
            return Err("文件正在保存，不能删除文档".into());
        }
        let mut records = self.records.lock().map_err(|_| "未保存文档不可用")?;
        if !records.contains_key(id) {
            return Err("文档不存在".into());
        }
        fs::remove_file(self.directory.join(format!("{id}.json")))
            .map_err(|error| error.to_string())?;
        records.remove(id);
        Ok(())
    }
    pub fn close(&self, id: &str) -> Result<(), String> {
        let busy = self.saving.lock().map_err(|_| "保存状态不可用")?;
        if busy.contains(id) {
            return Err("文件正在保存，不能关闭文档".into());
        }
        let mut records = self.records.lock().map_err(|_| "未保存文档不可用")?;
        if records
            .get(id)
            .is_some_and(|value| value.path.is_some() && value.source == value.base_source)
        {
            fs::remove_file(self.directory.join(format!("{id}.json")))
                .map_err(|error| error.to_string())?;
            records.remove(id);
        }
        Ok(())
    }
}
#[tauri::command]
pub async fn workbench_new_document(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        super::editor_window::editor(&window)?;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let record = app.state::<BufferDocuments>().create()?;
        if let Err(error) = super::editor_window::publish_file(&app, record.session(), false) {
            let retained = app
                .state::<super::editor_session::EditorSessionStore>()
                .read()?
                .is_some_and(|saved| {
                    saved
                        .files
                        .iter()
                        .any(|file| file.id == record.session().id)
                });
            if !retained {
                app.state::<BufferDocuments>().discard(&record.id)?;
            }
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn workbench_buffer_read(
    window: tauri::WebviewWindow,
    id: String,
) -> Result<BufferRecord, String> {
    super::editor_window::editor(&window)?;
    window.state::<BufferDocuments>().get(&id)
}
#[tauri::command]
pub fn workbench_buffer_checkpoint(
    window: tauri::WebviewWindow,
    id: String,
    version: u64,
    source: String,
    base: Option<BufferBase>,
) -> Result<BufferRecord, String> {
    super::editor_window::editor(&window)?;
    window
        .state::<BufferDocuments>()
        .checkpoint(&id, version, source, base)
}
#[tauri::command]
pub fn workbench_buffer_snapshot(
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Value, String> {
    super::editor_window::editor(&window)?;
    let value = window.state::<BufferDocuments>().get(&id)?;
    if let Some(path) = value.path {
        serde_json::to_value(local_files::read_selected_file(&path)?)
            .map_err(|error| error.to_string())
    } else {
        Ok(
            json!({ "source": value.source, "revision": format!("buffer:{}", value.version), "bom": false, "lineEnding": "lf", "size": value.source.len(), "modifiedMs": 0 }),
        )
    }
}
#[tauri::command]
pub async fn workbench_buffer_save(
    window: tauri::WebviewWindow,
    id: String,
    source: String,
    revision: String,
    bom: bool,
    line_ending: String,
) -> Result<Option<Value>, String> {
    super::editor_window::editor(&window)?;
    let app = window.app_handle().clone();
    let _saving = super::editor_window::reserve_buffer_save(&app, &id)?;
    let record = app.state::<BufferDocuments>().get(&id)?;
    let reservation: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    struct Reservation<'a>(&'a tauri::WebviewWindow, Arc<Mutex<Option<PathBuf>>>);
    impl Drop for Reservation<'_> {
        fn drop(&mut self) {
            if let Ok(mut path) = self.1.lock() {
                if let Some(path) = path.take() {
                    self.0
                        .state::<FileWindowAccess>()
                        .release_editor_path(self.0.label(), &path);
                }
            }
        }
    }
    let _reservation = Reservation(&window, reservation.clone());
    let (path, snapshot) = if let Some(path) = record.path {
        let value = path.clone();
        let target = window.clone();
        let text = source.clone();
        let expected = revision.clone();
        let snapshot = tauri::async_runtime::spawn_blocking(move || {
            super::editor_window::editor(&target)?;
            let _lease = target.state::<FileWindowAccess>().begin_paths(
                target.label(),
                false,
                vec![value.clone()],
            )?;
            local_files::write_selected_file(&value, &text, &expected, bom, &line_ending)
        })
        .await
        .map_err(|error| error.to_string())??;
        (path, snapshot)
    } else {
        let owner = window.clone();
        let scope = reservation.clone();
        let except = format!("workbench-buffer:{id}");
        let result = local_files::choose_save_file(
            app.clone(),
            window.clone(),
            record.name,
            source.clone(),
            false,
            "lf".into(),
            move |path| {
                if super::editor_window::path_is_open(owner.app_handle(), path, &except)? {
                    return Err("目标已在其它标签中打开，请选择其它名称".into());
                }
                if owner
                    .state::<FileWindowAccess>()
                    .protect_editor_path(owner.label(), path)?
                {
                    *scope.lock().map_err(|_| "保存状态不可用")? = Some(path.to_owned());
                }
                Ok(())
            },
        )
        .await;
        match result {
            Ok(Some(saved)) => saved,
            other => {
                if let Some(path) = reservation.lock().map_err(|_| "保存状态不可用")?.take()
                {
                    window
                        .state::<FileWindowAccess>()
                        .release_editor_path(window.label(), &path);
                }
                return other.map(|_| None);
            }
        }
    };
    let snapshot = serde_json::to_value(snapshot).map_err(|error| error.to_string())?;
    let saved = app
        .state::<BufferDocuments>()
        .committed(&id, path.clone(), &snapshot)
        .map_err(|error| {
            format!(
                "文件已写入 {}，但本机记录更新失败；草稿仍保留，请核对后再操作：{error}",
                path.display()
            )
        })?;
    super::editor_window::update_buffer(&app, saved.session()).map_err(|error| {
        format!(
            "文件已写入 {}，标签显示更新失败；本机编辑记录仍保留：{error}",
            path.display()
        )
    })?;
    reservation.lock().map_err(|_| "保存状态不可用")?.take();
    Ok(Some(json!({ "record": saved, "snapshot": snapshot })))
}

#[tauri::command]
pub fn workbench_buffer_discard(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    super::editor_window::editor(&window)?;
    super::editor_window::discard_buffer(window, format!("workbench-buffer:{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "workbench-buffers-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            )))
        }
        fn store(&self) -> BufferDocuments {
            BufferDocuments::load(&self.0, &mut Vec::new())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn untitled_contents_and_names_survive_restart_and_close_without_disk_path() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let first = store.create().unwrap();
        let second = store.create().unwrap();
        assert_eq!(first.name, "未命名");
        assert_eq!(second.name, "未命名 2");
        store
            .checkpoint(&first.id, first.version, "临时想法\nhello".into(), None)
            .unwrap();
        store.close(&first.id).unwrap();
        drop(store);
        let restored = fixture.store();
        assert_eq!(restored.list().unwrap().len(), 2);
        let value = restored.get(&first.id).unwrap();
        assert_eq!(value.source, "临时想法\nhello");
        assert!(value.path.is_none());
        assert!(value.session().file["untitled"].as_bool().unwrap());
    }
    #[test]
    fn checkpoint_rejects_stale_versions_oversize_and_mutation_during_save() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let first = store.create().unwrap();
        let next = store.checkpoint(&first.id, 1, "new".into(), None).unwrap();
        assert!(store.checkpoint(&first.id, 1, "old".into(), None).is_err());
        assert!(store
            .checkpoint(&first.id, next.version, "x".repeat(MAX_BYTES + 1), None)
            .is_err());
        let saving = store.begin_save(&first.id).unwrap();
        assert!(store
            .checkpoint(&first.id, next.version, "lost".into(), None)
            .is_err());
        assert!(store.discard(&first.id).is_err());
        assert!(store.close(&first.id).is_err());
        assert!(store.begin_save(&first.id).is_err());
        drop(saving);
        assert_eq!(store.get(&first.id).unwrap().source, "new");
        store
            .checkpoint(&first.id, next.version, "".into(), None)
            .unwrap();
        assert_eq!(fixture.store().get(&first.id).unwrap().source, "");
    }
    #[test]
    fn saved_buffer_can_recover_edits_but_clean_close_removes_only_recovery_record() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let first = store.create().unwrap();
        let path = fixture.0.join("saved.txt");
        fs::write(&path, "saved").unwrap();
        let saved = store
            .committed(
                &first.id,
                path.clone(),
                &json!({"source":"saved", "revision":"rev", "bom":true,"lineEnding":"crlf"}),
            )
            .unwrap();
        assert!(saved.bom);
        assert_eq!(saved.line_ending, "crlf");
        let edited = store
            .checkpoint(&first.id, saved.version, "edited".into(), None)
            .unwrap();
        store.close(&first.id).unwrap();
        assert_eq!(fixture.store().get(&first.id).unwrap().source, "edited");
        store
            .checkpoint(&first.id, edited.version, "saved".into(), None)
            .unwrap();
        store.close(&first.id).unwrap();
        assert!(fixture.store().list().unwrap().is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), "saved");
        let another = store.create().unwrap();
        store.discard(&another.id).unwrap();
        assert!(fixture.store().list().unwrap().is_empty());
    }
    #[test]
    fn saved_buffer_restores_its_binding_from_the_record_with_an_older_manifest() {
        let fixture = Fixture::new();
        let mut notices = Vec::new();
        let buffers = fixture.0.join("editor-documents");
        let store = BufferDocuments::load(&buffers, &mut notices);
        let first = store.create().unwrap();
        let manifest = fixture.0.join("editor-session.json");
        let sessions =
            super::super::editor_session::EditorSessionStore::load(&manifest, &mut notices);
        let tab = first.session();
        sessions
            .save(std::slice::from_ref(&tab), Some(&tab.id))
            .unwrap();

        let path = fixture.0.join("saved.txt");
        fs::write(&path, "saved").unwrap();
        store
            .committed(
                &first.id,
                path.clone(),
                &json!({"source":"saved", "revision":"rev"}),
            )
            .unwrap();

        let sessions =
            super::super::editor_session::EditorSessionStore::load(&manifest, &mut notices);
        let session = sessions.read().unwrap().unwrap();
        assert_eq!(session.current.as_deref(), Some(tab.id.as_str()));
        assert_eq!(session.files[0].file["untitled"], true);
        let id = session.files[0].file["bufferId"].as_str().unwrap();
        let restored = BufferDocuments::load(&buffers, &mut notices)
            .get(id)
            .unwrap();
        assert!(notices.is_empty());
        assert_eq!(restored.session().id, tab.id);
        assert_eq!(restored.path.as_deref(), Some(path.as_path()));
        assert_eq!(restored.base_revision, "rev");
    }
    #[test]
    fn checkpoint_persists_the_reloaded_disk_baseline_with_the_draft() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let first = store.create().unwrap();
        let path = fixture.0.join("saved.txt");
        fs::write(&path, "external").unwrap();
        let saved = store
            .committed(
                &first.id,
                path.clone(),
                &json!({"source":"previous", "revision":"first"}),
            )
            .unwrap();
        store
            .checkpoint(
                &first.id,
                saved.version,
                "local edit".into(),
                Some(BufferBase {
                    source: "external".into(),
                    revision: "second".into(),
                    bom: true,
                    line_ending: "crlf".into(),
                }),
            )
            .unwrap();
        let reopened = fixture.store().get(&first.id).unwrap();
        assert_eq!(reopened.source, "local edit");
        assert_eq!(reopened.base_source, "external");
        assert_eq!(reopened.base_revision, "second");
        assert_eq!(reopened.line_ending, "crlf");
        assert!(reopened.bom);
        assert_eq!(fs::read_to_string(path).unwrap(), "external");
    }
    #[test]
    fn limit_and_corruption_never_evict_existing_documents() {
        let fixture = Fixture::new();
        let store = fixture.store();
        for _ in 0..32 {
            store.create().unwrap();
        }
        assert!(store.create().is_err());
        assert_eq!(fixture.store().list().unwrap().len(), 32);
        let first = store.list().unwrap()[0].clone();
        let path = fixture.0.join(format!("{}.json", first.id));
        fs::write(&path, "invalid json").unwrap();
        let mut notices = Vec::new();
        let recovered = BufferDocuments::load(&fixture.0, &mut notices);
        assert_eq!(notices.len(), 1);
        assert_eq!(recovered.list().unwrap().len(), 31);
        assert_eq!(fs::read_to_string(&path).unwrap(), "invalid json");
    }
}

/// Explicitly closed unsaved documents stay recoverable without silently
/// reopening their tabs on the next launch.
#[tauri::command]
pub async fn workbench_reopen_drafts(window: tauri::WebviewWindow) -> Result<usize, String> {
    if window.label() != "main" {
        super::editor_window::editor(&window)?;
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let files = app
            .state::<super::editor_session::EditorSessionStore>()
            .read()?
            .map(|saved| saved.files)
            .unwrap_or_default();
        let documents = app.state::<BufferDocuments>().list()?;
        let mut opened = 0;
        for document in documents {
            let file = document.session();
            if files.iter().any(|open| open.id == file.id) {
                continue;
            }
            super::editor_window::publish_file(&app, file, document.path.is_some())
                .map_err(|error| format!("已恢复 {opened} 份编辑草稿；其余草稿仍保留：{error}"))?;
            opened += 1;
        }
        Ok(opened)
    })
    .await
    .map_err(|error| error.to_string())?
}
