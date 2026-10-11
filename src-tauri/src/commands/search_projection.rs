//! Device-local derived index version. Not part of document metadata or backups.
use crate::AppState;
use rusqlite::{params, Connection};
use tauri::State;

const FORMAT_VERSION: i64 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Source {
    id: String,
    content: String,
    #[serde(default, skip_serializing)]
    text: String,
}

fn check_version(version: i64) -> Result<(), String> {
    if version != FORMAT_VERSION {
        return Err("Unsupported search text format".into());
    }
    Ok(())
}

pub fn sources(conn: &Connection, version: i64) -> rusqlite::Result<Option<Vec<Source>>> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='_search_projection_version' AND type='table')", [], |row| row.get(0))?;
    if exists
        && conn.query_row(
            "SELECT COALESCE(MAX(version),0) FROM _search_projection_version",
            [],
            |row| row.get::<_, i64>(0),
        )? == version
    {
        return Ok(None);
    }
    let mut stmt = conn.prepare("SELECT id, content FROM notes")?;
    let rows = stmt.query_map([], |row| {
        Ok(Source {
            id: row.get(0)?,
            content: row.get(1)?,
            text: String::new(),
        })
    })?;
    Ok(Some(rows.collect::<rusqlite::Result<_>>()?))
}

pub fn apply(conn: &Connection, version: i64, records: &[Source]) -> rusqlite::Result<bool> {
    let tx = conn.unchecked_transaction()?;
    let total: usize = tx.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
    if total != records.len() {
        return Ok(false);
    }
    let mut ids = std::collections::HashSet::new();
    for record in records {
        if !ids.insert(&record.id) {
            return Ok(false);
        }
        // Text is untrusted derived output: encrypted envelopes can never be indexed.
        let encrypted = serde_json::from_str::<serde_json::Value>(&record.content)
            .ok()
            .is_some_and(|body| body.get("encrypted").is_some());
        let text = if encrypted { "" } else { record.text.as_str() };
        if tx.execute(
            "UPDATE notes SET search_text=?1 WHERE id=?2 AND content=?3",
            params![text, record.id, record.content],
        )? != 1
        {
            return Ok(false);
        }
    }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS _search_projection_version (version INTEGER NOT NULL); DELETE FROM _search_projection_version;")?;
    tx.execute(
        "INSERT INTO _search_projection_version(version) VALUES (?1)",
        [version],
    )?;
    tx.commit()?;
    Ok(true)
}

#[tauri::command]
pub fn get_search_text_rebuild(
    state: State<AppState>,
    version: i64,
) -> Result<Option<Vec<Source>>, String> {
    check_version(version)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    sources(&conn, version).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_search_text_rebuild(
    state: State<AppState>,
    version: i64,
    records: Vec<Source>,
) -> Result<bool, String> {
    check_version(version)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    apply(&conn, version, &records).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rebuild_is_atomic_and_preserves_concurrent_edits_and_encryption() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn.execute("INSERT INTO notes(id,date,content,search_text,created_at,updated_at) VALUES ('a','2026-10-11','{\"ops\":[]}','old','created','updated'), ('b','2026-10-11','{\"encrypted\":{}}','leak','created','updated')", []).unwrap();
        let mut batch = sources(&conn, FORMAT_VERSION).unwrap().unwrap();
        for row in &mut batch {
            row.text = "fresh".into();
        }
        conn.execute("UPDATE notes SET content='{}' WHERE id='b'", [])
            .unwrap();
        assert!(!apply(&conn, FORMAT_VERSION, &batch).unwrap());
        assert_eq!(
            conn.query_row("SELECT search_text FROM notes WHERE id='a'", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
            "old"
        );
        conn.execute(
            "UPDATE notes SET content='{\"encrypted\":{}}' WHERE id='b'",
            [],
        )
        .unwrap();
        assert!(apply(&conn, FORMAT_VERSION, &batch).unwrap());
        assert!(sources(&conn, FORMAT_VERSION).unwrap().is_none());
        assert_eq!(
            conn.query_row("SELECT search_text FROM notes WHERE id='b'", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
            ""
        );
        assert_eq!(
            conn.query_row("SELECT updated_at FROM notes WHERE id='a'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "updated"
        );
        assert!(
            conn.query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'fresh'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap()
                > 0
        );
    }
}
