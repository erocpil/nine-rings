use rusqlite::Connection;
use serde::{Deserialize, Serialize};

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

pub fn insert_note(conn: &Connection, note: &Note) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
        ],
    )?;
    Ok(())
}

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

pub fn soft_delete_note(conn: &Connection, id: &str, updated_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![updated_at, id],
    )?;
    Ok(())
}

pub fn select_notes_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes
         WHERE date = ?1 AND deleted_at IS NULL
         ORDER BY pinned DESC, sort_order ASC, created_at ASC"
    )?;
    let rows = stmt.query_map(rusqlite::params![date], |row| note_from_row(row))?;
    rows.collect()
}

pub fn select_note_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes WHERE id = ?1 AND deleted_at IS NULL"
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| note_from_row(row))?;
    rows.next().transpose()
}

/// 按标签筛选笔记
pub fn select_notes_by_tag(conn: &Connection, tag: &str) -> rusqlite::Result<Vec<Note>> {
    let pattern = format!("%\"{}\"%", tag.replace('"', ""));
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes
         WHERE deleted_at IS NULL AND tags LIKE ?1
         ORDER BY updated_at DESC
         LIMIT 100"
    )?;
    let rows = stmt.query_map(rusqlite::params![pattern], |row| note_from_row(row))?;
    rows.collect()
}

/// 获取所有已使用的标签（去重）
pub fn select_all_tags(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT tags FROM notes WHERE deleted_at IS NULL AND tags != '[]'"
    )?;
    let rows = stmt.query_map([], |row| {
        let json: String = row.get(0)?;
        Ok(json)
    })?;
    let mut tag_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for row in rows {
        if let Ok(json) = row {
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json) {
                for t in tags {
                    tag_set.insert(t);
                }
            }
        }
    }
    Ok(tag_set.into_iter().collect())
}

pub fn search_notes_like(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes
         WHERE deleted_at IS NULL
           AND (title LIKE ?1 ESCAPE '\\' OR search_text LIKE ?1 ESCAPE '\\')
         ORDER BY updated_at DESC
         LIMIT 50"
    )?;
    let rows = stmt.query_map(rusqlite::params![pattern], |row| note_from_row(row))?;
    rows.collect()
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
         FROM daily_pages WHERE date = ?1"
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

pub fn select_prev_carryover_page(conn: &Connection, before_date: &str) -> rusqlite::Result<Option<DailyPage>> {
    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at
         FROM daily_pages
         WHERE date < ?1
         ORDER BY date DESC
         LIMIT 1"
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

fn note_from_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let content_str: String = row.get(3)?;
    let tags_json: String = row.get(5)?;
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
    })
}
