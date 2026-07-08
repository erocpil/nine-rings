use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub date: String,
    pub title: Option<String>,
    pub content: serde_json::Value,
    pub search_text: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub order: i32,
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
        "INSERT INTO notes (id, date, title, content, search_text, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            note.id,
            note.date,
            note.title,
            note.content.to_string(),
            note.search_text,
            note.created_at,
            note.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_note(conn: &Connection, id: &str, title: Option<&str>, content: &serde_json::Value, search_text: &str, updated_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, search_text = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![title, content.to_string(), search_text, updated_at, id],
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
        "SELECT id, date, title, content, search_text, created_at, updated_at
         FROM notes
         WHERE date = ?1 AND deleted_at IS NULL
         ORDER BY created_at ASC"
    )?;
    let rows = stmt.query_map(rusqlite::params![date], |row| {
        note_from_row(row)
    })?;
    rows.collect()
}

pub fn select_note_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, created_at, updated_at
         FROM notes WHERE id = ?1 AND deleted_at IS NULL"
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| {
        note_from_row(row)
    })?;
    rows.next().transpose()
}

fn note_from_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let content_str: String = row.get(3)?;
    Ok(Note {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        content: serde_json::from_str(&content_str).unwrap_or_default(),
        search_text: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn search_notes_like(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, created_at, updated_at
         FROM notes
         WHERE deleted_at IS NULL
           AND (title LIKE ?1 ESCAPE '\\' OR search_text LIKE ?1 ESCAPE '\\')
         ORDER BY updated_at DESC
         LIMIT 50"
    )?;
    let rows = stmt.query_map(rusqlite::params![pattern], |row| {
        note_from_row(row)
    })?;
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
        daily_page_from_row(row)
    })?;
    rows.next().transpose()
}

/// 查找指定日期前最近一个有 todo_carryover=true 的 daily_page
pub fn select_prev_carryover_page(conn: &Connection, before_date: &str) -> rusqlite::Result<Option<DailyPage>> {
    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at
         FROM daily_pages
         WHERE date < ?1
         ORDER BY date DESC
         LIMIT 1"
    )?;
    let mut rows = stmt.query_map(rusqlite::params![before_date], |row| {
        daily_page_from_row(row)
    })?;
    rows.next().transpose()
}

fn daily_page_from_row(row: &rusqlite::Row) -> rusqlite::Result<DailyPage> {
    let todos_str: String = row.get(1)?;
    Ok(DailyPage {
        date: row.get(0)?,
        todos: serde_json::from_str(&todos_str).unwrap_or_default(),
        todo_carryover: row.get(2)?,
        updated_at: row.get(3)?,
    })
}
