//! Verified cross-device fallback. Never permanently deletes source data.
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, PartialEq, Eq)]
struct Stamp {
    directory: bool,
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    readonly: bool,
    #[cfg(unix)]
    identity: (u64, u64, u32),
}
fn stamp(meta: &fs::Metadata) -> Stamp {
    Stamp {
        directory: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified: meta.modified().ok(),
        created: meta.created().ok(),
        readonly: meta.permissions().readonly(),
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt;
            (meta.dev(), meta.ino(), meta.mode())
        },
    }
}
fn regular_metadata(path: &Path) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let link = {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let link = meta.file_type().is_symlink();
    if link || !(meta.is_dir() || meta.is_file()) {
        return Err("跨磁盘移动不处理链接、重解析点或特殊文件".into());
    }
    Ok(meta)
}
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    stamp: Stamp,
    hash: Option<[u8; 32]>,
}
type Manifest = BTreeMap<PathBuf, Entry>;
fn manifest(root: &Path, hash_content: bool) -> Result<Manifest, String> {
    fn walk(
        root: &Path,
        path: &Path,
        depth: usize,
        entries: &mut Manifest,
        hash_content: bool,
    ) -> Result<(), String> {
        if depth > 64 || entries.len() >= 10000 {
            return Err("校验超过目录深度或 10000 项预算".into());
        }
        let before = stamp(&regular_metadata(path)?);
        let hash = if before.directory || !hash_content {
            None
        } else {
            let file = fs::File::open(path).map_err(|e| e.to_string())?;
            if stamp(&file.metadata().map_err(|e| e.to_string())?) != before {
                return Err("校验时来源文件已被替换".into());
            }
            let mut hasher = Sha256::new();
            let mut buffer = vec![0; 64 * 1024];
            let mut reader = file.take(before.size);
            let mut total = 0;
            loop {
                let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
                total += read as u64;
            }
            if total != before.size {
                return Err("校验期间文件被截断".into());
            }
            Some(hasher.finalize().into())
        };
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        let directory = before.directory;
        entries.insert(
            relative,
            Entry {
                stamp: before,
                hash,
            },
        );
        if directory {
            for child in fs::read_dir(path).map_err(|e| e.to_string())? {
                walk(
                    root,
                    &child.map_err(|e| e.to_string())?.path(),
                    depth + 1,
                    entries,
                    hash_content,
                )?;
            }
        }
        if entries
            .get(path.strip_prefix(root).map_err(|e| e.to_string())?)
            .map(|entry| &entry.stamp)
            != Some(&stamp(&regular_metadata(path)?))
        {
            return Err("校验期间文件或目录发生变化".into());
        }
        Ok(())
    }
    let mut entries = Manifest::new();
    walk(root, root, 0, &mut entries, hash_content)?;
    Ok(entries)
}
fn same_content(source: &Manifest, target: &Manifest) -> bool {
    source.len() == target.len()
        && source.iter().all(|(path, value)| {
            target.get(path).is_some_and(|other| {
                value.stamp.directory == other.stamp.directory
                    && value.stamp.size == other.stamp.size
                    && value.hash == other.hash
            })
        })
}
fn same_stamps(before: &Manifest, after: &Manifest) -> bool {
    before.len() == after.len()
        && before.iter().all(|(path, entry)| {
            after
                .get(path)
                .is_some_and(|value| value.stamp == entry.stamp)
        })
}
fn rename_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::AlreadyExists {
        format!("TARGET_EXISTS: 目标名称已存在，未覆盖：{error}")
    } else {
        error.to_string()
    }
}
pub(super) fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path; // Windows exclusive publication uses MOVEFILE_WRITE_THROUGH.
    Ok(())
}
pub(super) fn sync_copied_file(path: &Path, permissions: fs::Permissions) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Open a flush-capable handle even when the copied file is read-only;
        // restore its original flag before flushing, including on open failure.
        let mut writable = permissions.clone();
        writable.set_readonly(false);
        fs::set_permissions(path, writable).map_err(|e| e.to_string())?;
        let file = fs::OpenOptions::new().read(true).write(true).open(path);
        let restore = fs::set_permissions(path, permissions);
        file.map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        restore.map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        fs::set_permissions(path, permissions).map_err(|e| e.to_string())?;
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub(super) fn create_private_directory(path: &Path) -> io::Result<()> {
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let mut builder = builder;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// Use an explicitly recoverable platform operation, never permanent deletion.
pub(super) fn recycle_verified_source(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = trash::TrashContext::new();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        // A dedicated STA avoids depending on the async worker's COM apartment.
        let path = path.to_path_buf();
        std::thread::Builder::new()
            .name("nr-recycle-source".into())
            .spawn(move || windows_recycle(&path))
            .map_err(|e| e.to_string())?
            .join()
            .map_err(|_| "回收站操作未确认完成".to_string())?
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn windows_recycle(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
                FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NO_CONNECTED_ELEMENTS,
                FOF_NO_UI, FOF_WANTNUKEWARNING,
            },
        },
    };
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    // The Shell does not accept std::fs canonical verbatim path prefixes.
    if wide.starts_with(&[92, 92, 63, 92, 85, 78, 67, 92]) {
        drop(wide.splice(0..8, [92, 92]));
    } else if wide.starts_with(&[92, 92, 63, 92]) {
        drop(wide.drain(0..4));
    }
    wide.push(0);
    let execute = || -> windows::core::Result<()> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let _apartment = Apartment;
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            // FOF_ALLOWUNDO alone is only best-effort. Require recycle explicitly.
            operation.SetOperationFlags(
                FOF_NO_UI
                    | FOF_ALLOWUNDO
                    | FOF_WANTNUKEWARNING
                    | FOFX_RECYCLEONDELETE
                    | FOFX_EARLYFAILURE
                    | FOF_NO_CONNECTED_ELEMENTS,
            )?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
            operation.DeleteItem(&item, None)?;
            operation.PerformOperations()?;
            if operation.GetAnyOperationsAborted()?.as_bool() {
                return Err(windows::core::Error::new(
                    windows::Win32::Foundation::E_ABORT,
                    "系统回收站操作已中止",
                ));
            }
            Ok(())
        }
    };
    execute().map_err(|e| format!("系统回收站未确认接收来源（不执行永久删除）：{e}"))
}

pub(super) fn move_with_fallback(
    source: &Path,
    target: &Path,
    validate: impl Fn() -> Result<(), String>,
    rename: impl Fn(&Path, &Path) -> io::Result<()>,
    copy: impl FnOnce(&Path, &Path) -> Result<(), String>,
    retire: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    match rename(source, target) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(rename_error(error)),
    }
    validate()?;
    let parent = target.parent().ok_or("目标没有父目录")?;
    let staging = parent.join(format!(".nine-rings-copy-{}", uuid::Uuid::new_v4()));
    create_private_directory(&staging).map_err(|e| e.to_string())?;
    let item = staging.join("item");
    let prepared = (|| {
        let before = manifest(source, true)?;
        copy(source, &item)?;
        if manifest(source, true)? != before {
            return Err("复制期间来源内容或目录结构发生变化，源文件保留".into());
        }
        if !same_content(&before, &manifest(&item, true)?) {
            return Err("目标内容校验失败，源文件保留".into());
        }
        validate()?;
        sync_directory(&staging)?;
        rename(&item, target).map_err(rename_error)?;
        Ok::<_, String>(before)
    })();
    // Only this operation's exclusive staging directory may be removed.
    let cleanup = fs::remove_dir_all(&staging);
    let before = prepared.map_err(|error| match &cleanup {
        Ok(()) => error,
        Err(cause) => format!("{error}；临时目录清理失败 {}：{cause}", staging.display()),
    })?;
    let finalize = (|| {
        cleanup.map_err(|e| format!("临时目录清理失败：{e}"))?;
        sync_directory(parent)?;
        validate()?;
        let published = manifest(target, true)?;
        if !same_content(&before, &published) {
            return Err("已发布目标被修改，未处理来源".into());
        }
        if manifest(source, true)? != before {
            return Err("来源在目标发布后发生变化，未处理来源".into());
        }
        if !same_stamps(&before, &manifest(source, false)?)
            || !same_stamps(&published, &manifest(target, false)?)
        {
            return Err("最终检查发现来源或目标再次变化，未处理来源".into());
        }
        validate()?;
        retire(source)
    })();
    finalize.map_err(|error: String| format!("MOVE_COPY_PUBLISHED: 目标副本已发布 {}；来源 {} 尚未确认移至系统回收站，请核对两处，不要直接重试：{error}", target.display(), source.display()))
}
