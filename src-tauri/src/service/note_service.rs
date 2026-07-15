use crate::db;
use crate::db::models::{DailyPage, Note, Todo};
use rusqlite::Connection;

// ──── Note CRUD ────

pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::search_notes(conn, query)
}

pub fn get_notes_by_tag(conn: &Connection, tag: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_tag(conn, tag)
}

pub fn get_all_tags(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    db::models::select_all_tags(conn)
}

pub fn reorder_note(conn: &Connection, id: &str, new_order: i32) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE notes SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_order, now, id])?;
    db::models::select_note_by_id(conn, id)
}

// ──── DailyPage ────

pub fn get_or_create_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<DailyPage> {
    if let Some(page) = db::models::select_daily_page(conn, date)? {
        return Ok(page);
    }
    let prev = db::models::select_prev_carryover_page(conn, date)?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(prev) = prev {
        if prev.todo_carryover {
            let incompleted: Vec<Todo> = prev.todos.into_iter().filter(|t| !t.done).collect();
            let page = DailyPage { date: date.to_string(), todos: incompleted, todo_carryover: true, updated_at: now };
            db::models::upsert_daily_page(conn, &page)?;
            return Ok(page);
        }
    }
    let page = DailyPage { date: date.to_string(), todos: vec![], todo_carryover: false, updated_at: now };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}

pub fn get_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<Option<DailyPage>> {
    db::models::select_daily_page(conn, date)
}

pub fn update_todos(conn: &Connection, date: &str, todos: &[Todo], todo_carryover: bool) -> rusqlite::Result<DailyPage> {
    let now = chrono::Utc::now().to_rfc3339();
    let page = DailyPage { date: date.to_string(), todos: todos.to_vec(), todo_carryover, updated_at: now };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}
