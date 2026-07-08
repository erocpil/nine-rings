use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub pushed: u32,
    pub pulled: u32,
}

/// 推送本地变更到远端（TODO: 接入 HTTP 后端）
pub fn push(_conn: &Connection) -> rusqlite::Result<SyncResult> {
    // TODO: 收集未同步变更，POST 到同步后端
    Ok(SyncResult { pushed: 0, pulled: 0 })
}

/// 从远端拉取变更（TODO: 接入 HTTP 后端）
pub fn pull(_conn: &Connection) -> rusqlite::Result<SyncResult> {
    // TODO: GET /sync?since=last_sync_ts → 合并到本地
    Ok(SyncResult { pushed: 0, pulled: 0 })
}
