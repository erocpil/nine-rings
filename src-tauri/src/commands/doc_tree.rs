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

#[tauri::command]
pub fn get_path_tree(state: State<AppState>) -> Result<Vec<PathNode>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut nodes: Vec<PathNode> = Vec::new();

    // ── 文件夹计数：path → 该路径下的文档数 ──
    let mut folder_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut folder_paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    // ── 1. 文档类笔记（有 storage_path）──
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, storage_path, doc_type, updated_at, readonly \
                 FROM notes WHERE deleted_at IS NULL AND storage_path IS NOT NULL \
                 ORDER BY storage_path, updated_at DESC"
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,                    // id
                row.get::<_, Option<String>>(1)?,            // title
                row.get::<_, String>(2)?,                    // storage_path
                row.get::<_, Option<String>>(3)?,            // doc_type
                row.get::<_, Option<String>>(4)?,            // updated_at
                row.get::<_, Option<i32>>(5)?.unwrap_or(0) != 0, // readonly
            ))
        }).map_err(|e| e.to_string())?;

        for row in rows {
            let (id, title, storage_path, doc_type, updated_at, readonly) =
                row.map_err(|e| e.to_string())?;

            // 收集文件夹路径及计数
            let parts: Vec<&str> = storage_path.split('/').collect();
            for i in 1..=parts.len() {
                let prefix = parts[..i].join("/");
                folder_paths.insert(prefix.clone());
                *folder_counts.entry(prefix).or_default() += 1;
            }

            nodes.push(PathNode {
                name: title.unwrap_or_else(|| "无标题".to_string()),
                path: format!("{}/{}", storage_path, id),
                node_type: "document".to_string(),
                note_id: Some(id),
                doc_type,
                children: vec![],
                updated_at,
                count: None,
                readonly: Some(readonly),
            });
        }
    }

    // ── 2. 每日随笔 → 注入虚拟 daily/YYYY-MM-DD/ 路径 ──
    {
        let mut daily_stmt = conn
            .prepare(
                "SELECT id, date, title, updated_at \
                 FROM notes WHERE deleted_at IS NULL AND storage_path IS NULL \
                 ORDER BY date DESC, updated_at DESC"
            )
            .map_err(|e| e.to_string())?;
        let daily_rows = daily_stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,              // id
                row.get::<_, String>(1)?,              // date
                row.get::<_, Option<String>>(2)?,      // title
                row.get::<_, Option<String>>(3)?,      // updated_at
            ))
        }).map_err(|e| e.to_string())?;

        let mut dates: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

        for row in daily_rows {
            let (id, date, title, updated_at) = row.map_err(|e| e.to_string())?;
            dates.insert(date.clone());
            nodes.push(PathNode {
                name: title.unwrap_or_else(|| "无标题".to_string()),
                path: format!("daily/{}/{}", date, id),
                node_type: "document".to_string(),
                note_id: Some(id),
                doc_type: None,
                children: vec![],
                updated_at,
                count: None,
                readonly: Some(false),
            });
        }

        if !dates.is_empty() {
            // daily/ 根文件夹
            folder_paths.insert("daily".to_string());
            folder_counts.insert("daily".to_string(), dates.len());

            for date in &dates {
                let date_path = format!("daily/{}", date);
                folder_paths.insert(date_path.clone());
                folder_counts.insert(date_path.clone(),
                    nodes.iter().filter(|n| n.path.starts_with(&format!("{}/", date_path))).count());
            }
        }
    }

    // ── 3. 文件夹节点 ──
    for folder_path in &folder_paths {
        let parts: Vec<&str> = folder_path.split('/').collect();
        nodes.push(PathNode {
            name: parts.last().unwrap_or(&"").to_string(),
            path: folder_path.clone(),
            node_type: "folder".to_string(),
            note_id: None,
            doc_type: None,
            children: vec![],
            updated_at: None,
            count: Some(*folder_counts.get(folder_path).unwrap_or(&0)),
            readonly: None,
        });
    }

    Ok(nodes)
}
