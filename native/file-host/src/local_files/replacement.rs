use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileRevision {
    identity: String,
    digest: String,
    size: u64,
    modified_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplacementReview {
    source: FileRevision,
    target: FileRevision,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementPaths {
    root_id: String,
    node: String,
    target_root_id: String,
    target_node: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementResult {
    backup_path: PathBuf,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod atomic {
    use super::*;
    use std::{
        ffi::{CStr, CString, OsStr},
        io::{self, Seek, SeekFrom},
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{
                ffi::OsStrExt,
                fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
            },
        },
    };

    const DIRECTORY: i32 = libc::O_RDONLY | libc::O_DIRECTORY;
    const READ: i32 = libc::O_RDONLY | libc::O_NONBLOCK;
    const CREATE: i32 = libc::O_RDWR | libc::O_CREAT | libc::O_EXCL;

    fn status(result: libc::c_int) -> io::Result<()> {
        if result == -1 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    fn name(segment: &OsStr) -> io::Result<CString> {
        CString::new(segment.as_bytes()).map_err(io::Error::other)
    }
    fn open_at(dir: &fs::File, name: &CStr, flags: i32) -> io::Result<fs::File> {
        let fd = unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                flags | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600 as libc::c_uint,
            )
        };
        status(fd)?;
        // A successful openat returns a new owned descriptor.
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }
    fn directory(path: &Path) -> io::Result<fs::File> {
        let mut current = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY)
            .open("/")?;
        for component in path.components() {
            match component {
                Component::RootDir => {}
                Component::Normal(segment) => {
                    current = open_at(&current, &name(segment)?, DIRECTORY)?
                }
                _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "无效目录")),
            }
        }
        Ok(current)
    }
    fn verify_directory(path: &Path, opened: &fs::File) -> io::Result<()> {
        let before = opened.metadata()?;
        let actual = directory(path)?.metadata()?;
        if actual.dev() != before.dev() || actual.ino() != before.ino() {
            return Err(io::Error::other("目标目录已变化"));
        }
        Ok(())
    }
    fn revision(dir: &fs::File, name: &CStr) -> Result<(FileRevision, fs::File), String> {
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
        status(unsafe {
            libc::fstatat(
                dir.as_raw_fd(),
                name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        })
        .map_err(|error| error.to_string())?;
        let metadata = unsafe { metadata.assume_init() };
        if metadata.st_mode & libc::S_IFMT != libc::S_IFREG {
            return Err("仅支持普通文件".into());
        }
        let mut file = open_at(dir, name, READ).map_err(|error| error.to_string())?;
        let before = file.metadata().map_err(|error| error.to_string())?;
        if !before.is_file() || before.len() > MAX_DIGEST_BYTES {
            return Err("仅支持不超过 256 MiB 的普通文件".into());
        }
        let digest = digest_stream(&file, before.len())?;
        let current = open_at(dir, name, READ)
            .and_then(|file| file.metadata())
            .map_err(|error| error.to_string())?;
        if !same_digest_identity(&before, &current) {
            return Err("检查时文件已变化".into());
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        Ok((
            FileRevision {
                identity: format!("{}:{}", before.dev(), before.ino()),
                digest,
                size: before.len(),
                modified_ms: before
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis())
                    .unwrap_or_default(),
            },
            file,
        ))
    }
    fn endpoints(
        source_root: &Path,
        node: &str,
        target_root: &Path,
        target: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        if node.is_empty() || target.is_empty() {
            return Err("授权目录本身不能参与替换".into());
        }
        Ok((
            checked_path(source_root, node)?,
            checked_path(target_root, target)?,
        ))
    }
    fn parent(path: &Path) -> Result<(&Path, CString), String> {
        let parent = path.parent().ok_or("文件目录无效")?;
        let filename = path.file_name().ok_or("文件名称无效")?;
        Ok((parent, name(filename).map_err(|error| error.to_string())?))
    }
    fn open_review(
        source_parent: &fs::File,
        source_name: &CStr,
        target_parent: &fs::File,
        target_name: &CStr,
    ) -> Result<(ReplacementReview, fs::File), String> {
        let (source, source_file) = revision(source_parent, source_name)?;
        let (target, target_file) = revision(target_parent, target_name)?;
        if target_file
            .metadata()
            .map_err(|error| error.to_string())?
            .permissions()
            .readonly()
        {
            return Err("目标是只读文件".into());
        }
        if source.identity == target.identity {
            return Err("来源和目标是同一个文件".into());
        }
        Ok((ReplacementReview { source, target }, source_file))
    }
    pub(super) fn review(
        source_root: &Path,
        node: &str,
        target_root: &Path,
        target: &str,
    ) -> Result<ReplacementReview, String> {
        let (source, target) = endpoints(source_root, node, target_root, target)?;
        let (source_parent, source_name) = parent(&source)?;
        let (target_parent, target_name) = parent(&target)?;
        let open = |path: &Path| directory(path).map_err(|error| error.to_string());
        let (review, _) = open_review(
            &open(source_parent)?,
            &source_name,
            &open(target_parent)?,
            &target_name,
        )?;
        Ok(review)
    }
    fn rename_at(
        staging: &fs::File,
        incoming: &CStr,
        destination: &fs::File,
        name: &CStr,
        exchange: bool,
    ) -> io::Result<()> {
        #[cfg(target_os = "macos")]
        let result = unsafe {
            libc::renameatx_np(
                staging.as_raw_fd(),
                incoming.as_ptr(),
                destination.as_raw_fd(),
                name.as_ptr(),
                if exchange {
                    libc::RENAME_SWAP
                } else {
                    libc::RENAME_EXCL
                },
            )
        };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                staging.as_raw_fd(),
                incoming.as_ptr(),
                destination.as_raw_fd(),
                name.as_ptr(),
                if exchange {
                    libc::RENAME_EXCHANGE
                } else {
                    libc::RENAME_NOREPLACE
                },
            )
        };
        status(result)
    }
    pub(super) fn exchange_save(temp: &Path, target: &Path) -> Result<(), String> {
        let (source, incoming) = parent(temp)?;
        let (destination, name) = parent(target)?;
        if source != destination {
            return Err("暂存与原文件必须位于同一目录".into());
        }
        let dir = directory(destination).map_err(|error| error.to_string())?;
        rename_at(&dir, &incoming, &dir, &name, true).map_err(|error| error.to_string())
    }
    pub(super) fn rename_editor_file(
        source: &Path,
        target: &Path,
        stamp: &RelocationStamp,
    ) -> Result<(), String> {
        let (source_parent, source_name) = parent(source)?;
        let (target_parent, target_name) = parent(target)?;
        let open = |path: &Path| directory(path).map_err(|error| error.to_string());
        let source_dir = open(source_parent)?;
        let target_dir = open(target_parent)?;
        let (observed, file) = revision(&source_dir, &source_name)?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if observed.digest != stamp.digest
            || !stamp.matches_identity(metadata.dev(), metadata.ino())
        {
            return Err("来源在迁移期间已变化，请先刷新编辑器".into());
        }
        verify_directory(source_parent, &source_dir)
            .and_then(|_| verify_directory(target_parent, &target_dir))
            .and_then(|_| rename_at(&source_dir, &source_name, &target_dir, &target_name, false))
            .map_err(|error| error.to_string())
    }
    fn copy(mut source: &fs::File, mut target: &fs::File, size: u64) -> io::Result<()> {
        use std::io::Read;
        // Limit the copy itself in case another process grows the source after review.
        let copied = io::copy(&mut (&mut source).take(size + 1), &mut target)?;
        if copied != size {
            return Err(io::Error::other("复制期间来源大小已变化"));
        }
        target.set_permissions(fs::Permissions::from_mode(
            source.metadata()?.permissions().mode() & 0o777,
        ))?;
        target.sync_all()
    }
    pub(super) fn replace(
        source_root: &Path,
        node: &str,
        target_root: &Path,
        target_node: &str,
        expected: &ReplacementReview,
        before_publish: impl FnOnce() -> Result<(), String>,
    ) -> Result<ReplacementResult, String> {
        let reject = |cause: String| format!("REPLACEMENT_NOT_WRITTEN: {cause}");
        let io_reject = |error: io::Error| reject(error.to_string());
        let (source, target) =
            endpoints(source_root, node, target_root, target_node).map_err(reject)?;
        let (source_parent, source_name) = parent(&source).map_err(reject)?;
        let (destination, target_name) = parent(&target).map_err(reject)?;
        let source_dir = directory(source_parent).map_err(io_reject)?;
        let target_dir = directory(destination).map_err(io_reject)?;
        let (observed, source_file) =
            open_review(&source_dir, &source_name, &target_dir, &target_name).map_err(reject)?;
        if observed != *expected {
            return Err(reject("来源或目标已变化，请重新检查同名文件".into()));
        }
        let stage_leaf = format!(".nine-rings-replaced-{}", uuid::Uuid::new_v4());
        let stage_name =
            CString::new(stage_leaf.as_str()).map_err(|error| reject(error.to_string()))?;
        let stage_path = destination.join(stage_leaf);
        let backup = stage_path.join("previous");
        status(unsafe { libc::mkdirat(target_dir.as_raw_fd(), stage_name.as_ptr(), 0o700) })
            .map_err(io_reject)?;
        let stage = open_at(&target_dir, &stage_name, DIRECTORY).map_err(io_reject)?;
        let publish = (|| {
            let incoming_file =
                open_at(&stage, c"previous", CREATE).map_err(|error| error.to_string())?;
            copy(&source_file, &incoming_file, expected.source.size)
                .map_err(|error| error.to_string())?;
            let (incoming, _) = revision(&stage, c"previous")?;
            if incoming.digest != expected.source.digest {
                return Err("复制期间源内容已变化".into());
            }
            let manifest = serde_json::json!({ "targetName": target.file_name(), "expected": expected, "incoming": incoming });
            let receipt =
                open_at(&stage, c"replacement.json", CREATE).map_err(|error| error.to_string())?;
            serde_json::to_writer_pretty(&receipt, &manifest).map_err(|error| error.to_string())?;
            receipt
                .sync_all()
                .and_then(|_| stage.sync_all())
                .and_then(|_| target_dir.sync_all())
                .map_err(|error| error.to_string())?;
            let (observed, _) = open_review(&source_dir, &source_name, &target_dir, &target_name)?;
            if observed != *expected {
                return Err("发布前来源或目标已变化，请重新检查".into());
            }
            before_publish()?;
            verify_directory(source_parent, &source_dir)
                .and_then(|_| verify_directory(destination, &target_dir))
                .and_then(|_| verify_directory(&stage_path, &stage))
                .and_then(|_| rename_at(&stage, c"previous", &target_dir, &target_name, true))
                .map_err(|error| error.to_string())?;
            Ok(incoming)
        })();
        let incoming = match publish {
            Ok(incoming) => incoming,
            Err(cause) => {
                let _ =
                    status(unsafe { libc::unlinkat(stage.as_raw_fd(), c"previous".as_ptr(), 0) });
                let _ = status(unsafe {
                    libc::unlinkat(stage.as_raw_fd(), c"replacement.json".as_ptr(), 0)
                });
                if verify_directory(&stage_path, &stage).is_ok() {
                    let _ = status(unsafe {
                        libc::unlinkat(
                            target_dir.as_raw_fd(),
                            stage_name.as_ptr(),
                            libc::AT_REMOVEDIR,
                        )
                    });
                }
                return Err(reject(cause));
            }
        };
        // Preserve both files if publication has raced with another process.
        let verify = (|| {
            stage
                .sync_all()
                .and_then(|_| target_dir.sync_all())
                .and_then(|_| verify_directory(&stage_path, &stage))
                .map_err(|error| error.to_string())?;
            if revision(&stage, c"previous")?.0 != expected.target
                || revision(&target_dir, &target_name)?.0 != incoming
            {
                return Err("交换期间检测到外部变动".to_owned());
            }
            Ok(())
        })();
        verify.map_err(|cause| {
            format!(
                "REPLACEMENT_PUBLISHED: {cause}；请核对目标目录与原目标备份 {}",
                backup.display()
            )
        })?;
        Ok(ReplacementResult {
            backup_path: backup,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod atomic {
    use super::*;

    pub(super) fn review(
        _: &Path,
        _: &str,
        _: &Path,
        _: &str,
    ) -> Result<ReplacementReview, String> {
        Err("当前系统不支持保留旧版的原子替换".into())
    }
    pub(super) fn replace(
        _: &Path,
        _: &str,
        _: &Path,
        _: &str,
        _: &ReplacementReview,
        _: impl FnOnce() -> Result<(), String>,
    ) -> Result<ReplacementResult, String> {
        Err("REPLACEMENT_NOT_WRITTEN: 当前系统不支持保留旧版的原子替换".into())
    }
}

use atomic::{replace, review};

/// Reuse the same exchange primitive for revision-checked editor saves.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn exchange_save(temp: &Path, target: &Path) -> Result<(), String> {
    atomic::exchange_save(temp, target)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn rename_editor_file(
    source: &Path,
    target: &Path,
    stamp: &RelocationStamp,
) -> Result<(), String> {
    atomic::rename_editor_file(source, target, stamp)
}

fn authorized_paths(
    window: &tauri::WebviewWindow,
    library: &LocalFiles,
    paths: &ReplacementPaths,
) -> Result<
    (
        PathBuf,
        PathBuf,
        Option<crate::window_access::FileMutationLease>,
    ),
    String,
> {
    caller(window)?;
    if paths.node.is_empty() || paths.target_node.is_empty() {
        return Err("授权目录本身不能参与替换".into());
    }
    let source = library.root(&paths.root_id)?;
    let target = library.root(&paths.target_root_id)?;
    let lease = scoped_caller(
        window,
        true,
        vec![
            checked_path(&source, &paths.node)?,
            checked_path(&target, &paths.target_node)?,
        ],
    )?;
    Ok((source, target, lease))
}

#[tauri::command]
pub async fn workbench_preview_replacement(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    paths: ReplacementPaths,
) -> Result<ReplacementReview, String> {
    let (source, target, lease) = authorized_paths(&window, &library, &paths)?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let result = review(&source, &paths.node, &target, &paths.target_node)?;
        let roots = grants.lock().map_err(|_| "目录状态不可用")?;
        if roots.get(&paths.root_id) != Some(&source)
            || roots.get(&paths.target_root_id) != Some(&target)
        {
            return Err("目录授权已变化".into());
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn workbench_replace_file(
    window: tauri::WebviewWindow,
    library: State<'_, LocalFiles>,
    paths: ReplacementPaths,
    expected: ReplacementReview,
) -> Result<ReplacementResult, String> {
    let (source, target, lease) = authorized_paths(&window, &library, &paths)
        .map_err(|error| format!("REPLACEMENT_NOT_WRITTEN: {error}"))?;
    let grants = library.roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        replace(
            &source,
            &paths.node,
            &target,
            &paths.target_node,
            &expected,
            || {
                let roots = grants.lock().map_err(|_| "目录状态不可用")?;
                if roots.get(&paths.root_id) != Some(&source)
                    || roots.get(&paths.target_root_id) != Some(&target)
                {
                    return Err("目录授权已变化".into());
                }
                Ok(())
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;

    fn with_files(run: impl FnOnce(&Path)) {
        let root = std::env::temp_dir().join(format!("nr-replace-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone());
        fs::write(root.join("source"), "new contents").unwrap();
        fs::write(root.join("target"), "old contents").unwrap();
        run(&root);
    }

    #[test]
    fn exchanges_and_leaves_old_file_and_durable_receipt() {
        with_files(|root| {
            let expected = review(root, "source", root, "target").unwrap();
            let result = replace(root, "source", root, "target", &expected, || Ok(())).unwrap();
            assert_eq!(
                fs::read_to_string(root.join("source")).unwrap(),
                "new contents"
            );
            assert_eq!(
                fs::read_to_string(root.join("target")).unwrap(),
                "new contents"
            );
            assert_eq!(
                fs::read_to_string(&result.backup_path).unwrap(),
                "old contents"
            );
            assert!(result
                .backup_path
                .with_file_name("replacement.json")
                .is_file());
        });
    }

    #[test]
    fn blocks_stale_target_and_cleans_only_private_staging() {
        with_files(|root| {
            let expected = review(root, "source", root, "target").unwrap();
            fs::write(root.join("target"), "external").unwrap();
            let error = replace(root, "source", root, "target", &expected, || Ok(()))
                .err()
                .unwrap();
            assert!(error.starts_with("REPLACEMENT_NOT_WRITTEN:"));
            assert_eq!(fs::read_to_string(root.join("target")).unwrap(), "external");
            assert_eq!(fs::read_dir(root).unwrap().count(), 2);
        });
    }

    #[test]
    fn publication_denial_discards_staging_without_modifying_the_target() {
        with_files(|root| {
            let expected = review(root, "source", root, "target").unwrap();
            let error = replace(root, "source", root, "target", &expected, || {
                Err("目录授权已变化".into())
            })
            .err()
            .unwrap();
            assert!(error.starts_with("REPLACEMENT_NOT_WRITTEN:"));
            assert_eq!(
                fs::read_to_string(root.join("target")).unwrap(),
                "old contents"
            );
            assert_eq!(fs::read_dir(root).unwrap().count(), 2);
            assert!(review(root, "source", root, "").is_err());
        });
    }

    #[test]
    fn reports_unconfirmed_publication_and_keeps_a_racing_write() {
        with_files(|root| {
            let expected = review(root, "source", root, "target").unwrap();
            let error = replace(root, "source", root, "target", &expected, || {
                fs::write(root.join("target"), "external during exchange").unwrap();
                Ok(())
            })
            .err()
            .unwrap();
            assert!(error.starts_with("REPLACEMENT_PUBLISHED:"));
            let staging = fs::read_dir(root)
                .unwrap()
                .flatten()
                .find(|entry| entry.path().is_dir())
                .unwrap()
                .path();
            assert_eq!(
                fs::read_to_string(staging.join("previous")).unwrap(),
                "external during exchange"
            );
            assert_eq!(
                fs::read_to_string(root.join("target")).unwrap(),
                "new contents"
            );
        });
    }

    #[test]
    fn rejects_a_replaced_parent_directory_before_publication() {
        with_files(|root| {
            let destination = root.join("destination");
            let moved = root.join("moved");
            fs::create_dir(&destination).unwrap();
            fs::rename(root.join("target"), destination.join("target")).unwrap();
            let expected = review(root, "source", root, "destination/target").unwrap();
            let result = replace(
                root,
                "source",
                root,
                "destination/target",
                &expected,
                || {
                    fs::rename(&destination, &moved).unwrap();
                    fs::create_dir(&destination).unwrap();
                    fs::write(destination.join("target"), "unrelated file").unwrap();
                    Ok(())
                },
            );
            assert!(result
                .err()
                .unwrap()
                .starts_with("REPLACEMENT_NOT_WRITTEN:"));
            assert_eq!(
                fs::read_to_string(moved.join("target")).unwrap(),
                "old contents"
            );
            assert_eq!(
                fs::read_to_string(destination.join("target")).unwrap(),
                "unrelated file"
            );
        });
    }
}
