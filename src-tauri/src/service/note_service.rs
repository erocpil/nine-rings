use crate::db;
use crate::db::models::{DailyPage, Note, Todo};
use rusqlite::Connection;
use serde_json::Value;

pub fn get_notes_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_date(conn, date)
}

pub fn create_note(conn: &Connection, date: &str, title: Option<&str>, content: &Value) -> rusqlite::Result<Note> {
    let now = chrono::Utc::now().to_rfc3339();
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        date: date.to_string(),
        title: title.map(|s| s.to_string()),
        content: content.clone(),
        created_at: now.clone(),
        updated_at: now,
    };
    db::models::insert_note(conn, &note)?;
    Ok(note)
}

pub fn update_note(conn: &Connection, id: &str, title: Option<&str>, content: &Value) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    db::models::update_note(conn, id, title, content, &now)?;
    db::models::select_note_by_id(conn, id)
}

pub fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    db::models::soft_delete_note(conn, id, &now)
}

pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    // FTS5 查询语法: 转义并添加前缀匹配
    let fts_query = format!("\"{}\"*", query.replace('"', ""));
    db::models::search_notes_fts(conn, &fts_query)
}

pub fn get_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<Option<DailyPage>> {
    db::models::select_daily_page(conn, date)
}

pub fn update_todos(conn: &Connection, date: &str, todos: &[Todo], todo_carryover: bool) -> rusqlite::Result<DailyPage> {
    let now = chrono::Utc::now().to_rfc3339();
    let page = DailyPage {
        date: date.to_string(),
        todos: todos.to_vec(),
        todo_carryover,
        updated_at: now,
    };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}
