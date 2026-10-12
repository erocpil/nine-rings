use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize)]
struct Grant {
    id: String,
    path: PathBuf,
}
#[derive(Default)]
pub struct ImageLibrary {
    roots: Mutex<HashMap<String, PathBuf>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageNode {
    id: String,
    name: String,
    directory: bool,
    size: u64,
    modified: u64,
}
#[derive(Serialize)]
pub struct ImageRoot {
    id: String,
    name: String,
}
#[derive(Serialize)]
pub struct ImagePage {
    nodes: Vec<ImageNode>,
    next: Option<usize>,
}
fn caller(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("图片目录仅允许主窗口访问".into());
    }
    Ok(())
}
fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp"
    )
}
fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return meta.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn checked_path(root: &Path, node: &str) -> Result<PathBuf, String> {
    let relative = Path::new(node);
    if node.contains('\\')
        || node.contains(':')
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            && !node.is_empty()
    {
        return Err("无效的图片节点".into());
    }
    let mut path = root.to_path_buf();
    for component in relative.components() {
        path.push(component);
        if is_link(&fs::symlink_metadata(&path).map_err(|_| "文件已移动或不可访问")?) {
            return Err("不读取符号链接".into());
        }
    }
    let resolved = fs::canonicalize(&path).map_err(|_| "文件已移动或不可访问")?;
    if !resolved.starts_with(root) {
        return Err("文件超出授权目录".into());
    }
    Ok(resolved)
}
impl ImageLibrary {
    pub fn load(dir: &Path) -> Self {
        let grants: Vec<Grant> = fs::read(dir.join("image-library-roots.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            roots: Mutex::new(grants.into_iter().map(|g| (g.id, g.path)).collect()),
        }
    }
    fn root(&self, id: &str) -> Result<PathBuf, String> {
        self.roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .get(id)
            .cloned()
            .ok_or_else(|| "目录授权已撤销".into())
    }
    fn save(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let grants: Vec<Grant> = self
            .roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .iter()
            .map(|(id, path)| Grant {
                id: id.clone(),
                path: path.clone(),
            })
            .collect();
        fs::write(
            app.state::<crate::DataDir>()
                .0
                .join("image-library-roots.json"),
            serde_json::to_vec(&grants).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub async fn image_library_choose(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<ImageRoot>, String> {
    caller(&window)?;
    let picker = app.clone();
    let chosen =
        tauri::async_runtime::spawn_blocking(move || picker.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = fs::canonicalize(chosen.into_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !path.is_dir() {
        return Err("请选择目录".into());
    }
    let library = app.state::<ImageLibrary>();
    let id = uuid::Uuid::new_v4().to_string();
    library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .insert(id.clone(), path.clone());
    if let Err(error) = library.save(&app) {
        library
            .roots
            .lock()
            .map_err(|_| "目录状态不可用")?
            .remove(&id);
        return Err(error);
    }
    Ok(Some(ImageRoot {
        id,
        name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned(),
    }))
}
#[tauri::command]
pub fn image_library_roots(
    window: tauri::WebviewWindow,
    library: State<'_, ImageLibrary>,
) -> Result<Vec<ImageRoot>, String> {
    caller(&window)?;
    Ok(library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .iter()
        .map(|(id, path)| ImageRoot {
            id: id.clone(),
            name: path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .into_owned(),
        })
        .collect())
}
#[tauri::command]
pub fn image_library_remove(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, ImageLibrary>,
    root_id: String,
) -> Result<(), String> {
    caller(&window)?;
    library
        .roots
        .lock()
        .map_err(|_| "目录状态不可用")?
        .remove(&root_id);
    library.save(&app)
}
#[tauri::command]
pub async fn image_library_list(
    window: tauri::WebviewWindow,
    library: State<'_, ImageLibrary>,
    root_id: String,
    node: String,
    offset: usize,
) -> Result<ImagePage, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    tauri::async_runtime::spawn_blocking(move || list_images(&root, &node, offset))
        .await
        .map_err(|e| e.to_string())?
}
fn list_images(root: &Path, node: &str, offset: usize) -> Result<ImagePage, String> {
    let path = checked_path(root, node)?;
    let mut nodes = Vec::new();
    for (index, entry) in fs::read_dir(path).map_err(|_| "无法读取目录")?.enumerate() {
        if index >= 10000 {
            return Err("单目录超过 10000 项，请选择更具体的子目录".into());
        }
        let entry = entry.map_err(|_| "无法读取目录项")?;
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| "无法读取目录项")?;
        if is_link(&meta) || (!meta.is_dir() && (!meta.is_file() || !supported(&entry.path()))) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.contains('\\') || name.contains(':') {
            continue;
        }
        nodes.push(ImageNode {
            id: if node.is_empty() {
                name.clone()
            } else {
                format!("{node}/{name}")
            },
            name,
            directory: meta.is_dir(),
            size: meta.len(),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        });
    }
    nodes.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    let next = if offset.saturating_add(200) < nodes.len() {
        Some(offset + 200)
    } else {
        None
    };
    Ok(ImagePage {
        nodes: nodes.into_iter().skip(offset).take(200).collect(),
        next,
    })
}
#[tauri::command]
pub async fn image_library_read(
    window: tauri::WebviewWindow,
    library: State<'_, ImageLibrary>,
    root_id: String,
    node: String,
) -> Result<Vec<u8>, String> {
    caller(&window)?;
    let root = library.root(&root_id)?;
    tauri::async_runtime::spawn_blocking(move || read_image(&root, &node))
        .await
        .map_err(|e| e.to_string())?
}
fn read_image(root: &Path, node: &str) -> Result<Vec<u8>, String> {
    let path = checked_path(root, node)?;
    if !supported(&path) {
        return Err("不是支持的图片类型".into());
    }
    let file = fs::File::open(path).map_err(|_| "无法读取图片")?;
    if !file.metadata().map_err(|_| "无法读取图片")?.is_file() {
        return Err("不是图片文件".into());
    }
    let mut bytes = Vec::new();
    file.take(10 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取图片")?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err("图片为空或超过 10 MB".into());
    }
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escaped_nodes_and_non_images() {
        let root = std::env::temp_dir().join(format!("nr-image-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("test.png"), b"image").unwrap();
        let root = fs::canonicalize(root).unwrap();
        assert!(checked_path(&root, "test.png").is_ok());
        for node in [
            "../test.png",
            "/tmp/test.png",
            "C:\\test.png",
            "a/../../test.png",
        ] {
            assert!(checked_path(&root, node).is_err());
        }
        assert!(!supported(Path::new("script.svg")));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("test.png"), root.join("link.png")).unwrap();
            assert!(checked_path(&root, "link.png").is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pages_only_images_and_bounds_file_reads() {
        let root = std::env::temp_dir().join(format!("nr-image-list-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("album")).unwrap();
        fs::write(root.join("private.txt"), b"private").unwrap();
        for index in 0..205 {
            fs::write(root.join(format!("photo{index:03}.png")), b"image").unwrap();
        }
        let root = fs::canonicalize(root).unwrap();
        let page = list_images(&root, "", 0).unwrap();
        assert_eq!(page.nodes.len(), 200);
        assert_eq!(page.next, Some(200));
        assert!(page.nodes[0].directory);
        assert_eq!(list_images(&root, "", 200).unwrap().nodes.len(), 6);
        assert!(read_image(&root, "private.txt").is_err());
        assert_eq!(read_image(&root, "photo000.png").unwrap(), b"image");
        fs::write(root.join("large.png"), vec![0; 10 * 1024 * 1024 + 1]).unwrap();
        assert!(read_image(&root, "large.png").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
