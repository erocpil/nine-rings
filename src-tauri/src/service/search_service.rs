use crate::db::models::Note;
use rusqlite::Connection;

pub fn search(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    crate::db::models::search_notes_like(conn, query)
}
