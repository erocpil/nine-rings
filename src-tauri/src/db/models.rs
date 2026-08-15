use rusqlite::params;
use rusqlite::Connection;
use rusqlite::TransactionBehavior;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub date: String,
    pub title: Option<String>,
    pub content: serde_json::Value,
    pub search_text: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "storagePath")]
    pub storage_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "docType")]
    pub doc_type: Option<String>,
    #[serde(default)]
    pub concepts: Vec<String>,
    #[serde(default)]
    #[serde(alias = "linkedDocIds")]
    pub linked_doc_ids: Vec<String>,
    #[serde(default)]
    pub readonly: bool,
}

impl Note {
    /// 不在公开字段中暴露 search_text（内部搜索用）
    pub fn to_public(&self) -> NotePublic {
        NotePublic {
            id: self.id.clone(),
            date: self.date.clone(),
            title: self.title.clone(),
            content: self.content.clone(),
            tags: self.tags.clone(),
            pinned: self.pinned,
            sort_order: self.sort_order,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            storage_path: self.storage_path.clone(),
            doc_type: self.doc_type.clone(),
            concepts: self.concepts.clone(),
            linked_doc_ids: self.linked_doc_ids.clone(),
            readonly: self.readonly,
        }
    }
}

/// 对外暴露的 Note（不含 search_text）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotePublic {
    pub id: String,
    pub date: String,
    pub title: Option<String>,
    pub content: serde_json::Value,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "storagePath")]
    pub storage_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "docType")]
    pub doc_type: Option<String>,
    #[serde(default)]
    pub concepts: Vec<String>,
    #[serde(default)]
    #[serde(alias = "linkedDocIds")]
    pub linked_doc_ids: Vec<String>,
    #[serde(default)]
    pub readonly: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub order: i32,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyPage {
    pub date: String,
    pub todos: Vec<Todo>,
    pub todo_carryover: bool,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncChange {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub data: serde_json::Value,
    pub timestamp: String,
    pub synced_at: Option<String>,
}

// ──── DAO ────

#[allow(clippy::too_many_arguments)]
pub fn update_note(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    content: &serde_json::Value,
    search_text: &str,
    tags: &[String],
    pinned: bool,
    sort_order: i32,
    updated_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET title=?1, content=?2, search_text=?3, tags=?4, pinned=?5, sort_order=?6, updated_at=?7
         WHERE id=?8",
        rusqlite::params![
            title,
            content.to_string(),
            search_text,
            serde_json::to_string(tags).unwrap_or_default(),
            pinned,
            sort_order,
            updated_at,
            id,
        ],
    )?;
    Ok(())
}

pub fn select_note_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes WHERE id = ?1 AND deleted_at IS NULL"
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], note_from_row)?;
    rows.next().transpose()
}

/// 按标签筛选笔记
pub fn select_notes_by_tag(conn: &Connection, tag: &str) -> rusqlite::Result<Vec<Note>> {
    let pattern = format!("%\"{}\"%", tag.replace('"', ""));
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes
         WHERE deleted_at IS NULL AND tags LIKE ?1
         ORDER BY updated_at DESC
         LIMIT 100"
    )?;
    let rows = stmt.query_map(rusqlite::params![pattern], note_from_row)?;
    rows.collect()
}

/// 获取所有已使用的标签（去重）
pub fn select_all_tags(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT tags FROM notes WHERE deleted_at IS NULL AND tags != '[]'")?;
    let rows = stmt.query_map([], |row| {
        let json: String = row.get(0)?;
        Ok(json)
    })?;
    let mut tag_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for json in rows.flatten() {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json) {
            for t in tags {
                tag_set.insert(t);
            }
        }
    }
    Ok(tag_set.into_iter().collect())
}

pub fn search_notes_like(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes
         WHERE deleted_at IS NULL
           AND (title LIKE ?1 ESCAPE '\\' OR search_text LIKE ?1 ESCAPE '\\')
         ORDER BY updated_at DESC
         LIMIT 50"
    )?;
    let rows = stmt.query_map(rusqlite::params![pattern], note_from_row)?;
    rows.collect()
}

/// FTS5 全文搜索（BM25 排序），CJK 查询回退 LIKE
///
/// FTS5 默认 unicode61 分词器对 CJK 支持有限（中文字符不拆词），
/// 检测到 CJK 字符时回退 LIKE 保证中文搜索可用。
pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let has_cjk = query.chars().any(|c| {
        matches!(c,
            '\u{4E00}'..='\u{9FFF}'   // CJK Unified
            | '\u{3400}'..='\u{4DBF}' // CJK Ext-A
            | '\u{F900}'..='\u{FAFF}' // CJK Compat
            | '\u{3040}'..='\u{309F}' // Hiragana
            | '\u{30A0}'..='\u{30FF}' // Katakana
            | '\u{AC00}'..='\u{D7AF}' // Hangul
        )
    });

    if has_cjk || query.trim().is_empty() {
        return search_notes_like(conn, query);
    }

    // FTS5 查询：空格分词 + 前缀匹配
    let fts_query = query
        .split_whitespace()
        .map(|t| {
            let cleaned: String = t
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("\"{}\"*", cleaned.replace('"', ""))
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" AND ");

    if fts_query.is_empty() {
        return search_notes_like(conn, query);
    }

    // 尝试 FTS5，语法错误时回退 LIKE
    let sql = "SELECT n.id, n.date, n.title, n.content, n.search_text, n.tags, n.pinned, n.sort_order,
                      n.created_at, n.updated_at, n.storage_path, n.doc_type, n.concepts, n.linked_doc_ids, n.readonly
               FROM notes n
               JOIN notes_fts f ON n.rowid = f.rowid
               WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
               ORDER BY rank
               LIMIT 50";

    match conn.prepare(sql).and_then(|mut stmt| {
        stmt.query_map(rusqlite::params![fts_query], note_from_row)?
            .collect()
    }) {
        Ok(results) => Ok(results),
        Err(_) => search_notes_like(conn, query), // FTS5 语法错误 → LIKE
    }
}

// ──── DailyPage DAO ────

pub fn upsert_daily_page(conn: &Connection, page: &DailyPage) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO daily_pages (date, todos, todo_carryover, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(date) DO UPDATE SET
           todos = excluded.todos,
           todo_carryover = excluded.todo_carryover,
           updated_at = excluded.updated_at",
        rusqlite::params![
            page.date,
            serde_json::to_string(&page.todos).unwrap_or_default(),
            page.todo_carryover,
            page.updated_at,
        ],
    )?;
    Ok(())
}

pub fn select_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<Option<DailyPage>> {
    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at
         FROM daily_pages WHERE date = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![date], |row| {
        let todos_str: String = row.get(1)?;
        Ok(DailyPage {
            date: row.get(0)?,
            todos: serde_json::from_str(&todos_str).unwrap_or_default(),
            todo_carryover: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.next().transpose()
}

pub fn select_prev_carryover_page(
    conn: &Connection,
    before_date: &str,
) -> rusqlite::Result<Option<DailyPage>> {
    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at
         FROM daily_pages
         WHERE date < ?1
         ORDER BY date DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![before_date], |row| {
        let todos_str: String = row.get(1)?;
        Ok(DailyPage {
            date: row.get(0)?,
            todos: serde_json::from_str(&todos_str).unwrap_or_default(),
            todo_carryover: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.next().transpose()
}

/// 获取所有未删除笔记（用于导出）
pub fn select_all_active_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes WHERE deleted_at IS NULL
         ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map([], note_from_row)?;
    rows.collect()
}

/// 获取所有每日页（用于导出）
pub fn select_all_daily_pages(conn: &Connection) -> rusqlite::Result<Vec<DailyPage>> {
    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at FROM daily_pages ORDER BY date DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let todos_str: String = row.get(1)?;
        Ok(DailyPage {
            date: row.get(0)?,
            todos: serde_json::from_str(&todos_str).unwrap_or_default(),
            todo_carryover: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// 插入或替换笔记（用于导入）
pub fn upsert_note(conn: &Connection, note: &Note) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            note.id,
            note.date,
            note.title,
            note.content.to_string(),
            note.search_text,
            serde_json::to_string(&note.tags).unwrap_or_default(),
            note.pinned,
            note.sort_order,
            note.created_at,
            note.updated_at,
            note.storage_path,
            note.doc_type,
            serde_json::to_string(&note.concepts).unwrap_or_default(),
            serde_json::to_string(&note.linked_doc_ids).unwrap_or_default(),
            note.readonly,
        ],
    )?;
    Ok(())
}

pub fn note_from_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let content_str: String = row.get(3)?;
    let tags_json: String = row.get(5)?;
    let concepts_str: String = row.get::<_, Option<String>>(12)?.unwrap_or_default();
    let linked_str: String = row.get::<_, Option<String>>(13)?.unwrap_or_default();
    let readonly_raw: i32 = row.get::<_, Option<i32>>(14)?.unwrap_or(0);
    Ok(Note {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        content: serde_json::from_str(&content_str).unwrap_or_default(),
        search_text: row.get(4)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        pinned: row.get::<_, i32>(6)? != 0,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        storage_path: row.get::<_, Option<String>>(10)?,
        doc_type: row.get::<_, Option<String>>(11)?,
        concepts: serde_json::from_str(&concepts_str).unwrap_or_default(),
        linked_doc_ids: serde_json::from_str(&linked_str).unwrap_or_default(),
        readonly: readonly_raw != 0,
    })
}

// ──── upsert_note：专用命令的事务逻辑 ────

/// upsertNote 的输入。与 TS `CreateNoteInput` + 导入透传字段对齐。
///
/// - 业务字段（date/title/content/...）由 TS 端传入。
/// - `id` / `created_at` / `updated_at` 仅在导入路径显式透传（保留跨设备 UUID 与历史时间）。
/// - `search_text` 由 TS 端 `extractPlainText` 预计算，避免 Rust 重复实现 Delta 解析。
#[derive(Debug, Deserialize)]
pub struct UpsertNoteInput {
    pub date: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(alias = "storagePath", default)]
    pub storage_path: Option<String>,
    #[serde(alias = "docType", default)]
    pub doc_type: Option<String>,
    #[serde(default)]
    pub concepts: Option<Vec<String>>,
    #[serde(alias = "linkedDocIds", default)]
    pub linked_doc_ids: Option<Vec<String>>,
    #[serde(alias = "searchText", default)]
    pub search_text: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(alias = "createdAt", default)]
    pub created_at: Option<String>,
    #[serde(alias = "updatedAt", default)]
    pub updated_at: Option<String>,
}

/// upsertNote 的事务逻辑：单个 `BEGIN IMMEDIATE` 事务内完成查重 + 写入。
///
/// 与通用 `db_query` + `db_exec` 两步拼装不同，本函数将「查重（SELECT）与
/// 写入（INSERT OR REPLACE）」合并进同一事务，`BEGIN IMMEDIATE` 立即获取写锁，
/// 从源头消除 TOCTOU 竞态（两个并发 upsert 各自查到「不存在」后双双插入）。
///
/// 匹配谓词与 TS `core.ts::upsertMatchKey` 对齐：
/// - 显式 id（导入透传）→ 直接使用。
/// - 文档：storage_path + title。
/// - 随笔：title + date（且 storage_path 为空）。
///
/// 多命中时按 `updated_at DESC, id ASC` 取首条，保证确定性。
///
/// 命中已有笔记时保留旧元数据（created_at / sort_order / readonly）；新建则用默认值。
pub fn upsert_note_dedup(conn: &mut Connection, input: &UpsertNoteInput) -> rusqlite::Result<Note> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

    // ── 查重：决定最终 id，并保留命中行的元数据 ──
    let mut final_id = input.id.clone();
    let mut created_at = input.created_at.clone();
    let mut sort_order = 0i32;
    let mut readonly = false;

    if final_id.is_none() {
        if let (Some(sp), Some(t)) = (input.storage_path.as_ref(), input.title.as_ref()) {
            // 文档：storagePath + title
            let found = tx.query_row(
                "SELECT id, created_at, sort_order, readonly FROM notes
                 WHERE storage_path = ?1 AND title = ?2 AND deleted_at IS NULL
                 ORDER BY updated_at DESC, id ASC LIMIT 1",
                params![sp, t],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i32>(2)?,
                        r.get::<_, i32>(3)?,
                    ))
                },
            );
            if let Ok((id, ca, so, ro)) = found {
                final_id = Some(id);
                created_at = Some(ca);
                sort_order = so;
                readonly = ro != 0;
            }
        } else if let Some(t) = input.title.as_ref() {
            // 随笔：title + date（仅非文档笔记，storage_path 为空）
            let found = tx.query_row(
                "SELECT id, created_at, sort_order, readonly FROM notes
                 WHERE title = ?1 AND date = ?2 AND storage_path IS NULL AND deleted_at IS NULL
                 ORDER BY updated_at DESC, id ASC LIMIT 1",
                params![t, input.date],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i32>(2)?,
                        r.get::<_, i32>(3)?,
                    ))
                },
            );
            if let Ok((id, ca, so, ro)) = found {
                final_id = Some(id);
                created_at = Some(ca);
                sort_order = so;
                readonly = ro != 0;
            }
        }
    }

    let id = final_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let created = created_at.unwrap_or_else(|| now.clone());
    let updated = input.updated_at.clone().unwrap_or_else(|| now.clone());

    let content = input
        .content
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "ops": [] }));
    let search_text = input.search_text.clone().unwrap_or_default();
    let tags = input.tags.clone().unwrap_or_default();
    let pinned = input.pinned.unwrap_or(false);
    let concepts = input.concepts.clone().unwrap_or_default();
    let linked_doc_ids = input.linked_doc_ids.clone().unwrap_or_default();

    tx.execute(
        "INSERT OR REPLACE INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            input.date,
            input.title,
            content.to_string(),
            search_text,
            serde_json::to_string(&tags).unwrap_or_default(),
            pinned,
            sort_order,
            created,
            updated,
            input.storage_path,
            input.doc_type,
            serde_json::to_string(&concepts).unwrap_or_default(),
            serde_json::to_string(&linked_doc_ids).unwrap_or_default(),
            readonly,
        ],
    )?;

    tx.commit()?;

    // 读回完整 Note 返回
    select_note_by_id(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}
