use crate::db;
use crate::db::models::Note;
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
    conn.execute(
        "UPDATE notes SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_order, now, id],
    )?;
    db::models::select_note_by_id(conn, id)
}
