//! Exact-file relocation within a single Workbench grant.
use super::*;

/// Scope and revision proof used by Workbench's editor relocation journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelocationStamp {
    pub digest: String,
    identity: (u64, u64),
}
impl RelocationStamp {
    pub fn same_file(&self, other: &Self) -> bool {
        self.identity == other.identity
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(super) fn matches_identity(&self, device: u64, inode: u64) -> bool {
        self.identity == (device, inode)
    }
}
impl LocalFiles {
    pub fn editor_relocation_paths(
        &self,
        root_id: &str,
        node: &str,
        parent: &str,
        name: &str,
    ) -> Result<(PathBuf, PathBuf, String), String> {
        if node.is_empty() {
            return Err("不能移动授权根目录".into());
        }
        valid_name(name)?;
        let root = self.root(root_id)?;
        let source = checked_path(&root, node)?;
        let destination = checked_path(&root, parent)?;
        if !destination.is_dir()
            || !fs::symlink_metadata(&source)
                .map_err(|error| error.to_string())?
                .is_file()
        {
            return Err("只能迁移同一授权根内的普通文件".into());
        }
        let target = destination.join(name);
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
            Ok(_) => return Err("目标名称已存在，未覆盖".into()),
        }
        let target_node = if parent.is_empty() {
            name.to_owned()
        } else {
            format!("{parent}/{name}")
        };
        Ok((source, target, target_node))
    }

    pub fn editor_relocation_stamp(
        &self,
        root_id: &str,
        node: &str,
        path: &Path,
    ) -> Result<RelocationStamp, String> {
        if checked_path(&self.root(root_id)?, node)? != path {
            return Err("文件超出原目录授权".into());
        }
        relocation_stamp(path)
    }

    pub fn publish_editor_relocation(
        &self,
        root_id: &str,
        node: &str,
        target_node: &str,
        source: &Path,
        target: &Path,
        stamp: &RelocationStamp,
    ) -> Result<(), String> {
        let (parent, name) = target_node.rsplit_once('/').unwrap_or(("", target_node));
        let (current_source, current_target, _) =
            self.editor_relocation_paths(root_id, node, parent, name)?;
        let roots = self.roots.lock().map_err(|_| "目录状态不可用")?;
        let root = roots.get(root_id).ok_or("目录授权已撤销")?;
        if source != current_source
            || target != current_target
            || checked_path(root, node)? != source
        {
            return Err("来源在迁移期间已变化，请先刷新编辑器".into());
        }
        let current_parent = checked_path(root, parent)?;
        if target.parent() != Some(&current_parent) {
            return Err("目标目录在迁移期间已变化".into());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            replacement::rename_editor_file(source, target, stamp)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            if relocation_stamp(source)? != *stamp {
                return Err("来源在迁移期间已变化，请先刷新编辑器".into());
            }
            move_exclusive(source, target).map_err(|error| error.to_string())
        }
    }
}

pub fn sync_relocation_paths(source: &Path, target: &Path) -> Result<(), String> {
    let source = source.parent().ok_or("来源目录无效")?;
    let target = target.parent().ok_or("目标目录无效")?;
    crate::local_file_transfer::sync_directory(source)?;
    if source != target {
        crate::local_file_transfer::sync_directory(target)?;
    }
    Ok(())
}

fn relocation_stamp(path: &Path) -> Result<RelocationStamp, String> {
    let meta = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let digest = save_digest(path)?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        (meta.dev(), meta.ino())
    };
    #[cfg(windows)]
    let identity = {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION},
        };
        let file = fs::File::open(path).map_err(|error| error.to_string())?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
            .map_err(|error| error.to_string())?;
        (
            u64::from(info.dwVolumeSerialNumber),
            u64::from(info.nFileIndexHigh) << 32 | u64::from(info.nFileIndexLow),
        )
    };
    if !same_digest_identity(
        &meta,
        &fs::symlink_metadata(path).map_err(|error| error.to_string())?,
    ) {
        return Err("文件在迁移核验期间变化".into());
    }
    Ok(RelocationStamp { digest, identity })
}
