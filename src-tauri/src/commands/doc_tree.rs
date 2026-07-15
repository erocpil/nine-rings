use crate::AppState;
use tauri::State;

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

#[tauri::command]
pub fn search_docs(state: State<AppState>, query: DocSearchQuery) -> Result<Vec<crate::db::models::Note>, String> {
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
            sql.push_str(" AND storage_path LIKE ?");
            params.push(Box::new(format!("{}%", path)));
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
            sql.push_str(" AND concepts LIKE ?");
            params.push(Box::new(format!("%\"{}\"%", concept)));
        }
    }

    sql.push_str(" ORDER BY updated_at DESC LIMIT 50");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| crate::db::models::note_from_row(row))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes_by_path(state: State<AppState>, path_prefix: String) -> Result<Vec<crate::db::models::Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // daily/ 前缀 → 返回对应日期的每日随笔（无 storagePath）
    if path_prefix.starts_with("daily/") {
        let date = path_prefix.strip_prefix("daily/").unwrap_or("");
        if !date.is_empty() {
            let mut stmt = conn
                .prepare(
                    "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE deleted_at IS NULL AND date = ?1 ORDER BY updated_at DESC"
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map(rusqlite::params![date], |row| crate::db::models::note_from_row(row))
                .map_err(|e| e.to_string())?;
            return rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
        }
        // 纯 "daily/" → 返回所有每日随笔
        let mut stmt = conn
            .prepare(
                "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE deleted_at IS NULL AND storage_path IS NULL ORDER BY date DESC, updated_at DESC"
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| crate::db::models::note_from_row(row))
            .map_err(|e| e.to_string())?;
        return rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
    }

    // 普通文档路径
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE deleted_at IS NULL AND storage_path LIKE ?1 OR storage_path = ?2 ORDER BY updated_at DESC"
        )
        .map_err(|e| e.to_string())?;
    let pattern = format!("{}%", path_prefix);
    let rows = stmt.query_map(rusqlite::params![pattern, path_prefix], |row| crate::db::models::note_from_row(row))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_concepts(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT concepts FROM notes WHERE deleted_at IS NULL AND concepts != '[]'"
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let json: String = row.get(0)?;
        Ok(json)
    }).map_err(|e| e.to_string())?;
    let mut tag_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for row in rows {
        if let Ok(json) = row {
            if let Ok(concepts) = serde_json::from_str::<Vec<String>>(&json) {
                for c in concepts {
                    tag_set.insert(c);
                }
            }
        }
    }
    Ok(tag_set.into_iter().collect())
}
