use std::path::{Path, PathBuf};

/// WebView2 中可安全重建的渲染缓存目录。
///
/// `Local Storage`、`IndexedDB`、Cookies 和 Preferences 刻意不在这里：
/// Nine Rings 的窗口布局、最后文档和阅读位置保存在 Local Storage 中。
/// `Service Worker` 只服务于浏览器 PWA；桌面端遗留的注册会接管
/// `http://tauri.localhost` 并可能让入口请求等待数分钟，因此可安全移除。
const CACHE_PATHS: &[&[&str]] = &[
    &["Default", "Service Worker"],
    &["Default", "Cache"],
    &["Default", "Code Cache"],
    &["Default", "GPUCache"],
    &["GPUCache"],
    &["ShaderCache"],
    &["GrShaderCache"],
    &["DawnCache"],
    &["DawnGraphiteCache"],
    &["DawnWebGPUCache"],
];

#[derive(Debug, Default)]
pub struct CacheCleanupReport {
    pub removed: Vec<PathBuf>,
    pub failed: Vec<(PathBuf, String)>,
}

/// 只清理 WebView2 的可再生缓存，保留承载用户会话状态的 profile 数据。
pub fn clean_webview2_caches(profile_dir: &Path) -> CacheCleanupReport {
    let mut report = CacheCleanupReport::default();
    for parts in CACHE_PATHS {
        let path = parts
            .iter()
            .fold(profile_dir.to_path_buf(), |base, part| base.join(part));
        if !path.exists() {
            continue;
        }
        match std::fs::remove_dir_all(&path) {
            Ok(()) => report.removed.push(path),
            Err(error) => report.failed.push((path, error.to_string())),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::clean_webview2_caches;

    #[test]
    fn cache_cleanup_preserves_web_storage_and_preferences() {
        let root = std::env::temp_dir().join(format!(
            "nine-rings-webview-profile-test-{}",
            uuid::Uuid::new_v4()
        ));
        let cache_file = root.join("Default/Cache/Cache_Data/cache.bin");
        let gpu_file = root.join("ShaderCache/shader.bin");
        let service_worker = root.join("Default/Service Worker/Database/worker.db");
        let local_storage = root.join("Default/Local Storage/leveldb/state.ldb");
        let indexed_db = root.join("Default/IndexedDB/notes.leveldb/data.ldb");
        let preferences = root.join("Default/Preferences");

        for file in [
            &cache_file,
            &gpu_file,
            &service_worker,
            &local_storage,
            &indexed_db,
            &preferences,
        ] {
            std::fs::create_dir_all(file.parent().expect("test path has parent")).unwrap();
            std::fs::write(file, b"test").unwrap();
        }

        let report = clean_webview2_caches(&root);
        assert!(report.failed.is_empty());
        assert!(!cache_file.exists());
        assert!(!gpu_file.exists());
        assert!(
            !service_worker.exists(),
            "desktop startup must remove the PWA service worker"
        );
        assert!(
            local_storage.exists(),
            "session localStorage must survive startup cleanup"
        );
        assert!(indexed_db.exists(), "web data must survive startup cleanup");
        assert!(
            preferences.exists(),
            "WebView preferences must survive startup cleanup"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }
}
