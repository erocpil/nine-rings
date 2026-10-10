//! Durable session marker, independent of the document database and WebView.
//! A normal exit event is evidence of orderly shutdown, not proof that the OS
//! has already released every child process or file handle.
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub pid: u32,
    pub version: String,
    pub started_at: String,
    pub updated_at: String,
    pub phase: String,
    pub issue: Option<String>,
    pub job_object_enabled: Option<bool>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub abnormal: bool,
    pub checked: bool,
    pub healthy: bool,
    pub message: String,
    pub checkpoint: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub current: Session,
    pub previous: Option<Session>,
    pub recovery: Recovery,
    pub log_path: String,
    pub marker_error: Option<String>,
}
pub struct DesktopLifecycle {
    path: PathBuf,
    status: Mutex<Status>,
}
impl DesktopLifecycle {
    pub fn begin(dir: &Path, job_object_enabled: Option<bool>) -> Self {
        let path = dir.join("desktop-session.json");
        let (previous, read_error) = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Session>(&bytes) {
                Ok(session) => (Some(session), None),
                Err(e) => (None, Some(format!("前次会话记录无法解析：{e}"))),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let interrupted = path.with_extension("json.tmp").exists();
                (None, interrupted.then(|| "前次会话记录写入被中断".into()))
            }
            Err(e) => (None, Some(format!("前次会话记录无法读取：{e}"))),
        };
        let read_error = read_error.or_else(|| {
            path.with_extension("json.tmp")
                .exists()
                .then(|| "前次会话记录写入被中断".into())
        });
        let abnormal = read_error.is_some()
            || previous
                .as_ref()
                .is_some_and(|s| s.phase != "exited" || s.issue.is_some());
        let now = chrono::Utc::now().to_rfc3339();
        let current = Session {
            id: uuid::Uuid::new_v4().to_string(),
            pid: std::process::id(),
            version: format!("{} ({})", env!("CARGO_PKG_VERSION"), env!("GIT_HASH")),
            started_at: now.clone(),
            updated_at: now,
            phase: "starting".into(),
            issue: None,
            job_object_enabled,
        };
        let lifecycle = Self {
            path,
            status: Mutex::new(Status {
                current,
                previous,
                recovery: Recovery {
                    abnormal,
                    message: read_error.clone().unwrap_or_default(),
                    ..Recovery::default()
                },
                log_path: std::env::temp_dir()
                    .join("nine-rings-startup.log")
                    .to_string_lossy()
                    .into(),
                marker_error: read_error,
            }),
        };
        lifecycle.phase("starting", None);
        lifecycle
    }
    pub fn snapshot(&self) -> Status {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub fn phase(&self, phase: &str, issue: Option<String>) {
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        status.current.phase = phase.into();
        status.current.updated_at = chrono::Utc::now().to_rfc3339();
        if issue.is_some() {
            status.current.issue = issue;
        }
        if let Err(e) = persist(&self.path, &status.current) {
            status.marker_error = Some(format!("会话记录写入失败：{e}"));
            log::error!("session marker: {}", e);
        }
    }
    pub fn check_database(&self, conn: &Connection) -> bool {
        // Opening SQLite recovers committed WAL transactions automatically.
        // Never delete a WAL or replace the user's database on integrity failure.
        let result = (|| -> Result<(), String> {
            let mut stmt = conn
                .prepare("PRAGMA quick_check")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                let value = row.map_err(|e| e.to_string())?;
                if value != "ok" {
                    return Err(value);
                }
            }
            Ok(())
        })();
        let healthy = result.is_ok();
        let checkpoint = healthy.then(|| checkpoint(conn, "PASSIVE"));
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        status.recovery.checked = true;
        status.recovery.healthy = healthy;
        status.recovery.checkpoint = checkpoint.clone();
        status.recovery.message = match result {
            Ok(()) if status.recovery.abnormal => {
                "已检查数据库并恢复可用的已提交事务；无法恢复尚未保存的内存编辑。".into()
            }
            Ok(()) => "数据库检查通过。".into(),
            Err(e) => format!("数据库检查失败，已停止写入，保留原文件以便备份和排查：{e}"),
        };
        log::info!(
            "startup database: {}; checkpoint={:?}",
            status.recovery.message,
            checkpoint
        );
        drop(status);
        if !healthy {
            let _ = conn.execute_batch("PRAGMA query_only=ON");
        }
        self.phase(
            if healthy { "running" } else { "read-only" },
            (!healthy).then(|| "数据库完整性检查失败".into()),
        );
        healthy
    }
}
fn persist(path: &Path, session: &Session) -> std::io::Result<()> {
    use std::io::Write;
    let temporary = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec(session)?)?;
    file.sync_all()?;
    std::fs::rename(temporary, path)?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}
pub fn checkpoint(conn: &Connection, mode: &str) -> String {
    let started = std::time::Instant::now();
    let result = conn.query_row(&format!("PRAGMA wal_checkpoint({mode})"), [], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    });
    match result {
        Ok((busy, total, written)) => format!(
            "busy={busy}, WAL={total}, merged={written}, {}ms",
            started.elapsed().as_millis()
        ),
        Err(e) => format!(
            "checkpoint failed: {e}, {}ms",
            started.elapsed().as_millis()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("nr-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn unfinished_session_and_completed_exit_are_distinguished() {
        let p = root();
        let first = DesktopLifecycle::begin(&p, None);
        assert!(!first.snapshot().recovery.abnormal);
        first.phase("running", None);
        let second = DesktopLifecycle::begin(&p, None);
        assert!(second.snapshot().recovery.abnormal);
        assert_eq!(
            second.snapshot().previous.unwrap().id,
            first.snapshot().current.id
        );
        second.phase("exited", None);
        assert!(
            !DesktopLifecycle::begin(&p, None)
                .snapshot()
                .recovery
                .abnormal
        );
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn malformed_marker_and_shutdown_issue_are_not_reported_normal() {
        let p = root();
        std::fs::write(p.join("desktop-session.json"), b"broken").unwrap();
        let state = DesktopLifecycle::begin(&p, Some(false));
        assert!(state.snapshot().recovery.abnormal);
        assert!(state.snapshot().marker_error.is_some());
        state.phase("exited", Some("checkpoint failed".into()));
        assert!(
            DesktopLifecycle::begin(&p, None)
                .snapshot()
                .recovery
                .abnormal
        );
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn committed_wal_is_recovered_after_process_exit() {
        let p = root();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "desktop_lifecycle::tests::crash_child",
                "--exact",
                "--nocapture",
            ])
            .env("NR_CRASH_TEST_DIR", &p)
            .status()
            .unwrap();
        assert_eq!(result.code(), Some(23));
        let state = DesktopLifecycle::begin(&p, None);
        assert!(state.snapshot().recovery.abnormal);
        let conn = Connection::open(p.join("data.db")).unwrap();
        assert!(state.check_database(&conn));
        assert_eq!(
            conn.query_row("SELECT value FROM saved", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "committed"
        );
        drop(conn);
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn interrupted_marker_replacement_is_detected_even_after_normal_exit() {
        let p = root();
        let state = DesktopLifecycle::begin(&p, None);
        state.phase("exited", None);
        std::fs::write(p.join("desktop-session.json.tmp"), b"partial").unwrap();
        assert!(
            DesktopLifecycle::begin(&p, None)
                .snapshot()
                .recovery
                .abnormal
        );
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_database_is_preserved_and_reported() {
        let p = root();
        let data = p.join("corrupt.db");
        std::fs::write(&data, b"this is not a sqlite database").unwrap();
        let before = std::fs::read(&data).unwrap();
        let state = DesktopLifecycle::begin(&p, None);
        let conn = Connection::open(&data).unwrap();
        assert!(!state.check_database(&conn));
        assert!(!state.snapshot().recovery.healthy);
        assert_eq!(state.snapshot().current.phase, "read-only");
        assert_eq!(std::fs::read(&data).unwrap(), before);
        drop(conn);
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn crash_child() {
        let Some(p) = std::env::var_os("NR_CRASH_TEST_DIR") else {
            return;
        };
        let path = PathBuf::from(p);
        let state = DesktopLifecycle::begin(&path, None);
        state.phase("running", None);
        let conn = Connection::open(path.join("data.db")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES('committed');").unwrap();
        std::process::exit(23);
    }
}
