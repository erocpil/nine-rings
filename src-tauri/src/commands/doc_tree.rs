use crate::AppState;
use tauri::State;

const EXACT_CONCEPT_FILTER: &str =
    " AND EXISTS (SELECT 1 FROM json_each(notes.concepts) AS item WHERE item.value = ?)";

#[tauri::command]
pub fn get_document_source_formats(
    state: State<AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, json_extract(content, '$.metadata.sourceFormat') FROM notes WHERE deleted_at IS NULL AND storage_path IS NOT NULL AND json_valid(content) AND json_extract(content, '$.metadata.sourceFormat') IN ('text', 'markdown')").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// One SQL snapshot; no document bodies cross IPC.
pub fn document_summaries(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare("SELECT id, date, title, tags, pinned, readonly, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, length(CAST(content AS BLOB)), CASE WHEN json_valid(content) THEN CASE WHEN json_type(content, '$.metadata.sourceFormat') = 'text' THEN json_extract(content, '$.metadata.sourceFormat') END END, CASE WHEN json_valid(content) THEN CASE WHEN json_type(content, '$.metadata.originalFileName') = 'text' THEN json_extract(content, '$.metadata.originalFileName') END END FROM notes WHERE deleted_at IS NULL AND storage_path IS NOT NULL ORDER BY updated_at DESC, id ASC")?;
    let rows = stmt.query_map([], |row| {
        let format = row.get::<_, Option<String>>(14)?;
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?, "date": row.get::<_, String>(1)?,
            "title": row.get::<_, Option<String>>(2)?, "tags": row.get::<_, String>(3)?,
            "pinned": row.get::<_, bool>(4)?, "readonly": row.get::<_, bool>(5)?,
            "sort_order": row.get::<_, i64>(6)?, "created_at": row.get::<_, String>(7)?,
            "updated_at": row.get::<_, String>(8)?, "storage_path": row.get::<_, String>(9)?,
            "doc_type": row.get::<_, Option<String>>(10)?, "concepts": row.get::<_, String>(11)?,
            "linked_doc_ids": row.get::<_, String>(12)?, "contentBytes": row.get::<_, i64>(13)?,
            "sourceFormat": format.filter(|value| value == "text" || value == "markdown"),
            "originalFileName": row.get::<_, Option<String>>(15)?
        }))
    })?;
    rows.collect()
}

#[tauri::command]
pub fn get_document_summaries(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    document_summaries(&conn).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize)]
pub struct DocSearchQuery {
    pub text: Option<String>,
    pub storage_path: Option<String>,
    pub doc_type: Option<String>,
    pub concept: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PathNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String, // "folder" | "document"
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "noteId")]
    pub note_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "docType")]
    pub doc_type: Option<String>,
    #[serde(skip_serializing)]
    pub children: Vec<PathNode>, // kept for internal use, not sent to frontend
    pub updated_at: Option<String>,
    pub count: Option<usize>,
    pub readonly: Option<bool>,
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[tauri::command]
pub fn search_docs(
    state: State<AppState>,
    query: DocSearchQuery,
) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut sql = String::from(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE deleted_at IS NULL AND storage_path IS NOT NULL"
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref text) = query.text {
        if !text.is_empty() {
            sql.push_str(" AND (title LIKE ? OR search_text LIKE ?)");
            let pattern = format!("%{}%", text.replace('%', "\\%").replace('_', "\\_"));
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
    }
    if let Some(ref path) = query.storage_path {
        if !path.is_empty() {
            sql.push_str(" AND (storage_path = ? OR storage_path LIKE ? ESCAPE '\\')");
            params.push(Box::new(path.clone()));
            params.push(Box::new(format!("{}/%", escape_like(path))));
        }
    }
    if let Some(ref dt) = query.doc_type {
        if !dt.is_empty() {
            sql.push_str(" AND doc_type = ?");
            params.push(Box::new(dt.clone()));
        }
    }
    if let Some(ref concept) = query.concept {
        if !concept.is_empty() {
            sql.push_str(EXACT_CONCEPT_FILTER);
            params.push(Box::new(concept.clone()));
        }
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            crate::db::models::note_from_row(row)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes_by_path(
    state: State<AppState>,
    path_prefix: String,
) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // 普通文档路径
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE deleted_at IS NULL AND (storage_path = ?1 OR storage_path LIKE ?2 ESCAPE '\\') ORDER BY updated_at DESC"
        )
        .map_err(|e| e.to_string())?;
    let like_pattern = format!("{}/%", escape_like(&path_prefix));
    let rows = stmt
        .query_map(rusqlite::params![path_prefix, like_pattern], |row| {
            crate::db::models::note_from_row(row)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{escape_like, EXACT_CONCEPT_FILTER};
    use rusqlite::{params, Connection};

    #[test]
    fn summaries_omit_body_and_track_live_metadata_and_utf8_size() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let body = r#"{"ops":[{"insert":"中文正文"}],"metadata":{"sourceFormat":"markdown","originalFileName":"source.md"}}"#;
        conn.execute("INSERT INTO notes(id,date,title,content,created_at,updated_at,storage_path) VALUES ('a','2026-10-11','title',?1,'created','updated','ideas/path')", [body]).unwrap();
        let rows = super::document_summaries(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].get("content").is_none());
        assert_eq!(rows[0]["contentBytes"], body.len());
        assert_eq!(rows[0]["originalFileName"], "source.md");
        conn.execute(
            "UPDATE notes SET title='renamed', storage_path='projects/path' WHERE id='a'",
            [],
        )
        .unwrap();
        assert_eq!(
            super::document_summaries(&conn).unwrap()[0]["title"],
            "renamed"
        );
        conn.execute("UPDATE notes SET deleted_at='deleted' WHERE id='a'", [])
            .unwrap();
        assert!(super::document_summaries(&conn).unwrap().is_empty());
    }

    #[test]
    fn escapes_sql_like_metacharacters_in_folder_paths() {
        assert_eq!(
            escape_like(r"projects/100%_done\draft"),
            r"projects/100\%\_done\\draft"
        );
    }

    #[test]
    fn concept_filter_matches_json_array_elements_exactly() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, concepts TEXT NOT NULL);
             INSERT INTO notes VALUES ('percent', '[\"100%\"]');
             INSERT INTO notes VALUES ('expanded', '[\"100-percent\"]');
             INSERT INTO notes VALUES ('underscore', '[\"C_\"]');
             INSERT INTO notes VALUES ('single-char', '[\"C#\"]');
             INSERT INTO notes VALUES ('quote', '[\"say \\\"hi\\\"\"]');",
        )
        .unwrap();

        let sql = format!("SELECT id FROM notes WHERE 1=1{EXACT_CONCEPT_FILTER}");
        for (concept, expected_id) in [
            ("100%", "percent"),
            ("C_", "underscore"),
            ("say \"hi\"", "quote"),
        ] {
            let ids = conn
                .prepare(&sql)
                .unwrap()
                .query_map(params![concept], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert_eq!(ids, vec![expected_id]);
        }
    }
}

#[tauri::command]
pub fn get_all_concepts(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT concepts FROM notes WHERE deleted_at IS NULL AND concepts != '[]'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let json: String = row.get(0)?;
            Ok(json)
        })
        .map_err(|e| e.to_string())?;
    let mut tag_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for json in rows.flatten() {
        if let Ok(concepts) = serde_json::from_str::<Vec<String>>(&json) {
            for c in concepts {
                tag_set.insert(c);
            }
        }
    }
    Ok(tag_set.into_iter().collect())
}
