use crate::db::models::Note;
use rusqlite::Connection;

pub fn search(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    let fts_query = format!("\"{}\"*", query.replace('"', ""));
    crate::db::models::search_notes_fts(conn, &fts_query)
}
