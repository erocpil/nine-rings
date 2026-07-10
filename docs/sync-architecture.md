# Nine Rings — 云端同步架构思路

> 文件状态：设计草案 v1 · 2026-07-09

---

## 核心原则

1. **本地优先（Local-First）**：所有数据先在本地写入，同步在后台进行。无网络也能正常使用。
2. **用户自选后端**：对接用户自己的服务端（自建或第三方），不锁平台。
3. **增量同步**：只传有变动的数据，不每次全量。
4. **冲突可调停**：不同设备同时编辑时，有确定性的合并策略。

---

## 数据流

```
    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
    │  设备 A      │        │  同步服务端   │        │  设备 B      │
    │  IndexedDB   │◄──────►│  (API Server) │◄──────►│  IndexedDB   │
    │  / SQLite    │        │   PostgreSQL  │        │  / SQLite    │
    └──────────────┘        └──────────────┘        └──────────────┘
```

---

## 分层架构

```
┌──────────────────────────────────────────┐
│               UI 层 (React)               │
├──────────────────────────────────────────┤
│            StorageAdapter                │
│  (IndexedDB / Tauri IPC / SyncAdapter)   │
├──────────────────────────────────────────┤
│            SyncEngine                    │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ ChangeLog │  │  Pusher  │  │ Puller │ │
│  └──────────┘  └──────────┘  └────────┘ │
├──────────────────────────────────────────┤
│          SyncAdapter (抽象)              │
│  ┌──────────┐  ┌──────────┐             │
│  │ REST API │  │ WebSocket │             │
│  └──────────┘  └──────────┘             │
└──────────────────────────────────────────┘
```

### StorageAdapter 层（已存在）
当前 `api.ts` 已封装了适配器模式。同步时扩展：`StorageAdapter` 加 `syncPush()` / `syncPull()` 方法。

### SyncEngine（新增）
核心同步逻辑，独立于具体传输方式：

| 组件 | 职责 |
|------|------|
| ChangeLog | 记录每次数据变更（实体 ID + 动作 + 时间戳 + 旧值） |
| Pusher | 定时/手动推送 changelog 到服务端 |
| Puller | 拉取服务端最新变更，合并到本地 |

### SyncAdapter（新增）
传输层抽象——同一份 SyncEngine 可对接不同后端：

| 实现 | 适用场景 |
|------|----------|
| REST API | 自建后端、简单的 push/pull |
| WebSocket | 实时同步、多设备即时协同 |
| 文件导出 | 手动"同步"——导出 JSON 到另一台设备导入 |

---

## 数据模型

### 变更日志表 `sync_changelog`（本地）

```sql
CREATE TABLE sync_changelog (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,      -- 'note' | 'daily_page'
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,      -- 'create' | 'update' | 'delete'
  data        TEXT,               -- 变更后的完整 JSON 快照
  timestamp   TEXT NOT NULL,      -- ISO 8601
  synced_at   TEXT                -- NULL = 未同步
);
```

### 增量同步流程

**Push（本地 → 服务端）：**
```
1. SELECT * FROM sync_changelog WHERE synced_at IS NULL
2. POST /api/sync/push  { changes: [...] }
3. 服务端返回 { accepted: [...], conflicts: [...] }
4. 更新 synced_at = now()
```

**Pull（服务端 → 本地）：**
```
1. GET /api/sync/pull?since={last_sync_timestamp}
2. 服务端返回 { changes: [...] }
3. 按 timestamp 顺序应用到本地
4. 更新 last_sync_timestamp
```

---

## 冲突处理策略

### 策略选择：Last-Writer-Wins（LWW）+ 用户确认

**默认策略：最后写入者胜出**
- 每条数据带 `updated_at` 时间戳
- 同步时比较 `updated_at`，保留最新的版本
- 旧版本存入本地"冲突历史"供用户查阅

**冲突标记：**
当两个设备在短时间内先后修改同一条数据时：
```
设备 A: updated_at = T1, 写入 "买牛奶"
设备 B: updated_at = T2 (T2 > T1), 写入 "买燕麦奶"
同步结果：设备 A 的 "买牛奶" 被覆盖为 "买燕麦奶"
```

如果用户需要更细粒度的控制，后续可加"手动合并"面板。

---

## 服务端实现选项

| 方案 | 工作量 | 优点 | 缺点 |
|------|--------|------|------|
| **轻量 API Server**（Go / Rust） | 中 | 可控、自部署 | 需要服务器 |
| **Serverless**（Cloudflare Workers + D1） | 中 | 零运维、免费额度 | 锁定平台 |
| **Supabase / PocketBase** | 低 | 开箱即用 BaaS | 第三方依赖 |
| **WebDAV / iCloud Drive** | 低 | 用已有云盘同步 JSON | 冲突粒度粗 |

**推荐起步：Cloudflare Workers + D1** 或 **Supabase**
- Workers 无需管理服务器，D1 是 SQLite 兼容，数据模型可直接映射
- 两个设备的 Notes 表通过 Worker 接口做 push/pull

---

## 实施路线

| 阶段 | 内容 | 估算 |
|------|------|------|
| Phase 0 | 本地 SyncEngine + ChangeLog 表（夯实基础） | 3–5 天 |
| Phase 1 | 简单的 HTTP Push/Pull（自建 server 或 Supabase） | 5–7 天 |
| Phase 2 | 冲突检测 + 冲突 UI 面板 | 2–3 天 |
| Phase 3 | 增量同步优化 + WebSocket 实时 | 3–5 天 |
| Phase 4 | 端到端加密 + 用户鉴权 | 3–5 天 |

---

## 当前进度

- `api.ts` StorageAdapter 已有 `syncPush()` / `syncPull()` 存桩
- `src-tauri/src/service/sync_service.rs` 存桩
- 其余均为设计阶段
