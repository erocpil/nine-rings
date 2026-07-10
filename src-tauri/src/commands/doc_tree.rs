use crate::AppState;
use tauri::State;

#[derive(Debug, serde::Deserialize)]
pub struct DocSearchQuery {
    pub text: Option<String>,
    pub storage_path: Option<String>,
    pub doc_type: Option<String>,
    pub concept: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct PathNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String, // "folder" | "document"
    pub children: Vec<PathNode>,
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

#[tauri::command]
pub fn get_path_tree(state: State<AppState>) -> Result<Vec<PathNode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT storage_path, updated_at, readonly, COUNT(*) as cnt FROM notes WHERE deleted_at IS NULL AND storage_path IS NOT NULL GROUP BY storage_path ORDER BY storage_path"
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<i32>>(2)?.unwrap_or(0) != 0,
            row.get::<_, i32>(3)?,
        ))
    }).map_err(|e| e.to_string())?;

    #[derive(Default)]
    struct DirEntry {
        docs: Vec<PathNode>,
        folders: std::collections::BTreeSet<String>,
        updated_at: Option<String>,
        count: usize,
        readonly: bool,
    }
    let mut tree: std::collections::BTreeMap<String, DirEntry> = std::collections::BTreeMap::new();

    for row in rows {
        let (path, updated_at, readonly, _cnt) = row.map_err(|e| e.to_string())?;
        let parts: Vec<&str> = path.split('/').collect();
        for i in 1..=parts.len() {
            let prefix = parts[..i].join("/");
            let entry = tree.entry(prefix.clone()).or_default();
            if i == parts.len() {
                entry.docs.push(PathNode {
                    name: parts[i - 1].to_string(),
                    path: path.clone(),
                    node_type: "document".to_string(),
                    children: vec![],
                    updated_at: updated_at.clone(),
                    count: None,
                    readonly: Some(readonly),
                });
                entry.updated_at = updated_at.clone();
                entry.count += 1;
            } else {
                entry.folders.insert(parts[i].to_string());
            }
        }
    }

    fn build_children(tree: &std::collections::BTreeMap<String, DirEntry>, parent_path: &str) -> Vec<PathNode> {
        let mut nodes: Vec<PathNode> = Vec::new();
        if let Some(entry) = tree.get(parent_path) {
            // 子文件夹
            for folder_name in &entry.folders {
                let child_path = if parent_path.is_empty() {
                    folder_name.clone()
                } else {
                    format!("{}/{}", parent_path, folder_name)
                };
                let child_entry = tree.get(&child_path);
                let children = build_children(tree, &child_path);
                let count = child_entry.map(|e| e.count).unwrap_or(0);
                let updated_at = child_entry.and_then(|e| e.updated_at.clone());
                nodes.push(PathNode {
                    name: folder_name.clone(),
                    path: child_path.clone(),
                    node_type: "folder".to_string(),
                    children,
                    updated_at,
                    count: Some(count),
                    readonly: None,
                });
            }
            // 文档
            let mut docs = entry.docs.clone();
            docs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            nodes.extend(docs);
        }
        nodes
    }

    let roots = build_children(&tree, "");
    Ok(roots)
}
