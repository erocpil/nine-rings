//! Recoverable ordinary-file publication with ReplaceFileW.
use super::*;
use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
use windows::Win32::{
    Foundation::HANDLE,
    Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
    },
};

fn open(path: &Path, directory: bool) -> Result<fs::File, String> {
    let mut flags = FILE_FLAG_OPEN_REPARSE_POINT.0;
    if directory {
        flags |= FILE_FLAG_BACKUP_SEMANTICS.0;
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(flags)
        .open(path)
        .map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if is_link(&metadata)
        || if directory {
            !metadata.is_dir()
        } else {
            !metadata.is_file()
        }
    {
        return Err("路径已变为链接或节点类型已变化".into());
    }
    Ok(file)
}

fn identity(file: &fs::File) -> Result<String, String> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|error| error.to_string())?;
    Ok(format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    ))
}

fn revision(path: &Path) -> Result<FileRevision, String> {
    let file = open(path, false)?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > MAX_DIGEST_BYTES {
        return Err("文件超过同名替换的 256 MiB 上限".into());
    }
    let id = identity(&file)?;
    let digest = digest_stream(&file, metadata.len())?;
    let current = open(path, false)?;
    if identity(&current)? != id
        || !same_digest_identity(
            &metadata,
            &current.metadata().map_err(|error| error.to_string())?,
        )
    {
        return Err("核对修订期间文件已变化".into());
    }
    Ok(FileRevision {
        identity: id,
        digest,
        size: metadata.len(),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_millis()),
    })
}

fn endpoints(
    source_root: &Path,
    node: &str,
    target_root: &Path,
    target_node: &str,
) -> Result<(PathBuf, PathBuf), String> {
    if node.is_empty() || target_node.is_empty() {
        return Err("仅支持替换目录中的普通文件".into());
    }
    Ok((
        checked_path(source_root, node)?,
        checked_path(target_root, target_node)?,
    ))
}

fn review_files(source: &Path, target: &Path) -> Result<ReplacementReview, String> {
    if fs::metadata(target)
        .map_err(|error| error.to_string())?
        .permissions()
        .readonly()
    {
        return Err("目标文件为只读".into());
    }
    let source = revision(source)?;
    let target = revision(target)?;
    if source.identity == target.identity {
        return Err("来源与目标是同一个文件".into());
    }
    Ok(ReplacementReview { source, target })
}

pub(super) fn review(
    source_root: &Path,
    node: &str,
    target_root: &Path,
    target_node: &str,
) -> Result<ReplacementReview, String> {
    let (source, target) = endpoints(source_root, node, target_root, target_node)?;
    review_files(&source, &target)
}

pub(super) fn replace(
    source_root: &Path,
    node: &str,
    target_root: &Path,
    target_node: &str,
    expected: &ReplacementReview,
    before_publish: impl FnOnce() -> Result<(), String>,
) -> Result<ReplacementResult, String> {
    let not_written = |cause: String| format!("REPLACEMENT_NOT_WRITTEN: {cause}");
    let (source, target) =
        endpoints(source_root, node, target_root, target_node).map_err(not_written)?;
    if review_files(&source, &target).map_err(not_written)? != *expected {
        return Err(not_written("来源或目标已变化，请重新检查".into()));
    }
    let parent = target
        .parent()
        .ok_or_else(|| not_written("目标目录无效".into()))?;
    let source_parent = source
        .parent()
        .ok_or_else(|| not_written("来源目录无效".into()))?;
    let parent_identity = |path: &Path| identity(&open(path, true)?);
    let original_source_dir = parent_identity(source_parent).map_err(not_written)?;
    let original_dir = parent_identity(parent).map_err(not_written)?;
    let staging = parent.join(format!(".nine-rings-replaced-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|error| not_written(error.to_string()))?;
    let incoming = staging.join("incoming");
    let previous = staging.join("previous");
    let receipt = staging.join("replacement.json");
    let stage_identity = parent_identity(&staging).map_err(not_written)?;
    let same_stage = || parent_identity(&staging).as_deref() == Ok(stage_identity.as_str());

    let prepared = (|| {
        // A read-only share keeps the copied file stable and bounded while
        // the native copy preserves named streams.
        let source_pin = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(&source)
            .map_err(|error| error.to_string())?;
        if identity(&source_pin)? != expected.source.identity
            || source_pin
                .metadata()
                .map_err(|error| error.to_string())?
                .len()
                != expected.source.size
        {
            return Err("来源文件已变化，请重新检查".into());
        }
        fs::copy(&source, &incoming).map_err(|error| error.to_string())?;
        drop(source_pin);
        let copied = revision(&incoming)?;
        if copied.digest != expected.source.digest || copied.size != expected.source.size {
            return Err("复制期间源内容已变化".into());
        }
        let mut permissions = fs::metadata(&incoming)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&incoming, permissions).map_err(|error| error.to_string())?;
        fs::OpenOptions::new()
            .write(true)
            .open(&incoming)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        let manifest = serde_json::json!({ "targetName": target.file_name(), "expected": expected, "incoming": copied });
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&receipt)
            .map_err(|error| error.to_string())?;
        serde_json::to_writer_pretty(&file, &manifest).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        if review_files(&source, &target)? != *expected {
            return Err("发布前来源或目标已变化，请重新检查".into());
        }
        before_publish()?;
        if endpoints(source_root, node, target_root, target_node)?
            != (source.clone(), target.clone())
            || parent_identity(source_parent)? != original_source_dir
            || parent_identity(parent)? != original_dir
            || !same_stage()
        {
            return Err("发布前目录已变化，请重新检查".into());
        }
        Ok(copied)
    })();
    let copied = match prepared {
        Ok(copied) => copied,
        Err(error) => {
            if same_stage() {
                let _ = fs::remove_file(&incoming);
                let _ = fs::remove_file(&receipt);
                let _ = fs::remove_dir(&staging);
            }
            return Err(not_written(error));
        }
    };
    let uncertain = |reason: String| {
        format!(
            "REPLACEMENT_PUBLISHED: {reason}；请核对目标和恢复目录 {}",
            staging.display()
        )
    };
    // ReplaceFileW can return an error after moving the old file to the backup.
    // Once dispatched, preserve all recovery files on any failure.
    replace_save_with_backup(&incoming, &target, &previous).map_err(uncertain)?;
    let old = revision(&previous).map_err(uncertain)?;
    let published = revision(&target).map_err(uncertain)?;
    if old != expected.target
        || published.identity != copied.identity
        || published.digest != copied.digest
    {
        return Err(uncertain("替换完成，但实际修订与确认时不同".into()));
    }
    Ok(ReplacementResult {
        backup_path: previous,
    })
}
