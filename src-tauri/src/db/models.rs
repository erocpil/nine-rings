use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub date: String,
    pub title: Option<String>,
    pub content: serde_json::Value,
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
        "INSERT INTO notes (id, date, title, content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            note.id,
            note.date,
            note.title,
            note.content.to_string(),
            note.created_at,
            note.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_note(conn: &Connection, id: &str, title: Option<&str>, content: &serde_json::Value, updated_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![title, content.to_string(), updated_at, id],
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
        "SELECT id, date, title, content, created_at, updated_at
         FROM notes
         WHERE date = ?1 AND deleted_at IS NULL
         ORDER BY created_at ASC"
    )?;
    let rows = stmt.query_map(rusqlite::params![date], |row| {
        let content_str: String = row.get(3)?;
        Ok(Note {
            id: row.get(0)?,
            date: row.get(1)?,
            title: row.get(2)?,
            content: serde_json::from_str(&content_str).unwrap_or_default(),
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn select_note_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, created_at, updated_at
         FROM notes WHERE id = ?1 AND deleted_at IS NULL"
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| {
        let content_str: String = row.get(3)?;
        Ok(Note {
            id: row.get(0)?,
            date: row.get(1)?,
            title: row.get(2)?,
            content: serde_json::from_str(&content_str).unwrap_or_default(),
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.next().transpose()
}

pub fn search_notes_fts(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.date, n.title, n.content, n.created_at, n.updated_at
         FROM notes n
         JOIN notes_fts fts ON n.rowid = fts.rowid
         WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
         ORDER BY rank
         LIMIT 50"
    )?;
    let rows = stmt.query_map(rusqlite::params![query], |row| {
        let content_str: String = row.get(3)?;
        Ok(Note {
            id: row.get(0)?,
            date: row.get(1)?,
            title: row.get(2)?,
            content: serde_json::from_str(&content_str).unwrap_or_default(),
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
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
