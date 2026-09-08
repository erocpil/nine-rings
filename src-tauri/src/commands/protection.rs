//! Atomic ciphertext/path transitions. WebCrypto runs in the frontend; this
//! command never receives passwords/keys. A snapshot token prevents lost writes.
use crate::{db::models, AppState};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
pub struct ProtectionState {
    pub notes: Vec<Value>,
    pub versions: Vec<Value>,
    pub paths: Vec<Value>,
}

pub fn paths(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare("SELECT data FROM protected_paths ORDER BY id").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
}
pub fn snapshot(conn: &Connection) -> Result<ProtectionState, String> {
    let mut stmt = conn.prepare("SELECT id,date,title,content,search_text,tags,pinned,sort_order,created_at,updated_at,storage_path,doc_type,concepts,linked_doc_ids,readonly,deleted_at FROM notes ORDER BY id").map_err(|e| e.to_string())?;
    let notes = stmt.query_map([], |r| {
        let n = models::note_from_row(r)?;
        let deleted: Option<String> = r.get(15)?;
        Ok(json!({"id":n.id,"date":n.date,"title":n.title,"content":n.content,"tags":n.tags,"pinned":n.pinned,"readonly":n.readonly,"sort_order":n.sort_order,"created_at":n.created_at,"updated_at":n.updated_at,"storagePath":n.storage_path,"docType":n.doc_type,"concepts":n.concepts,"linkedDocIds":n.linked_doc_ids,"deleted_at":deleted,"search_text":n.search_text}))
    }).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,note_id,title,content,tags,pinned,sort_order,saved_at FROM note_versions ORDER BY id").map_err(|e| e.to_string())?;
    let versions = stmt.query_map([], |r| {
        let parse = |i| -> rusqlite::Result<Value> {
            let s: String = r.get(i)?;
            serde_json::from_str(&s).map_err(|e| rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e)))
        };
        Ok(json!({"id":r.get::<_,String>(0)?,"note_id":r.get::<_,String>(1)?,"title":r.get::<_,Option<String>>(2)?,"content":parse(3)?,"tags":parse(4)?,"pinned":r.get::<_,bool>(5)?,"sort_order":r.get::<_,i32>(6)?,"saved_at":r.get::<_,String>(7)?}))
    }).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    Ok(ProtectionState { notes, versions, paths: paths(conn)? })
}
fn revision(s: &ProtectionState) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    // Not a security credential: only an optimistic concurrency token.
    serde_json::to_string(s).unwrap().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
fn under(path: &str, parent: &str) -> bool { path == parent || path.starts_with(&format!("{parent}/")) }

pub fn validate(s: &ProtectionState) -> Result<(), String> {
    for (i, p) in s.paths.iter().enumerate() {
        let path = p["path"].as_str().ok_or("加密路径无效")?;
        if path.is_empty() || p["id"].as_str().is_none() || p["verifier"]["encrypted"]["protectionId"] != p["id"] { return Err("加密路径记录无效".into()); }
        for other in &s.paths[..i] {
            let op = other["path"].as_str().ok_or("加密路径无效")?;
            if p["id"] == other["id"] || under(path, op) || under(op, path) { return Err("加密路径重叠".into()); }
        }
    }
    for n in &s.notes {
        let c = &n["content"];
        if c.get("encrypted").is_some() && (c["ops"] != json!([]) || c.get("metadata").is_some() || c["encrypted"]["version"] != 1) { return Err("加密正文格式无效".into()); }
        if let Some(path) = n["storagePath"].as_str().or_else(|| n["storage_path"].as_str()) {
            for p in &s.paths {
                if under(path, p["path"].as_str().unwrap_or("")) && (c["encrypted"]["protectionId"] != p["id"] || c["encrypted"]["salt"] != p["verifier"]["encrypted"]["salt"]) { return Err("加密路径包含未受保护的文档".into()); }
            }
        }
        if c.get("encrypted").is_some() {
            for v in &s.versions {
                if v["note_id"] == n["id"] && (v["content"]["encrypted"]["protectionId"] != c["encrypted"]["protectionId"] || v["content"]["encrypted"]["salt"] != c["encrypted"]["salt"]) { return Err("历史版本保护不一致".into()); }
            }
        }
    }
    Ok(())
}

pub fn commit(conn: &Connection, expected: &str, next: &ProtectionState) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let before = snapshot(&tx)?;
    if revision(&before) != expected { return Err("文档或路径已被其他窗口修改，请重新操作；本次未写入数据".into()); }
    validate(next)?;
    if before.notes.iter().any(|n| !next.notes.iter().any(|v| v["id"] == n["id"])) || before.versions.iter().any(|n| !next.versions.iter().any(|v| v["id"] == n["id"])) { return Err("加密事务不能删除正文或历史".into()); }
    for raw in &next.notes {
        if before.notes.iter().any(|v| v == raw) { continue; }
        let n: models::NotePublic = serde_json::from_value(raw.clone()).map_err(|e| e.to_string())?;
        let search = if n.content.get("encrypted").is_some() { "" } else { raw["search_text"].as_str().unwrap_or("") };
        tx.execute("INSERT INTO notes (id,date,title,content,search_text,tags,pinned,sort_order,created_at,updated_at,storage_path,doc_type,concepts,linked_doc_ids,readonly,deleted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) ON CONFLICT(id) DO UPDATE SET date=excluded.date,title=excluded.title,content=excluded.content,search_text=excluded.search_text,tags=excluded.tags,pinned=excluded.pinned,sort_order=excluded.sort_order,updated_at=excluded.updated_at,storage_path=excluded.storage_path,doc_type=excluded.doc_type,concepts=excluded.concepts,linked_doc_ids=excluded.linked_doc_ids,readonly=excluded.readonly,deleted_at=excluded.deleted_at",
          params![n.id,n.date,n.title,n.content.to_string(),search,json!(n.tags).to_string(),n.pinned,n.sort_order,n.created_at,n.updated_at,n.storage_path,n.doc_type,json!(n.concepts).to_string(),json!(n.linked_doc_ids).to_string(),n.readonly,raw["deleted_at"].as_str()]).map_err(|e| e.to_string())?;
        // Incremental sync is not currently used, but old plaintext change logs
        // must not outlive encrypting their document.
        if n.content.get("encrypted").is_some() {
            tx.execute("DELETE FROM sync_changes WHERE entity_type='note' AND entity_id=?1", [&n.id]).map_err(|e| e.to_string())?;
        }
    }
    for v in &next.versions {
        if before.versions.iter().any(|old| old == v) { continue; }
        tx.execute("INSERT OR REPLACE INTO note_versions (id,note_id,title,content,tags,pinned,sort_order,saved_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![v["id"].as_str(),v["note_id"].as_str(),v["title"].as_str(),v["content"].to_string(),v["tags"].to_string(),v["pinned"].as_bool().unwrap_or(false),v["sort_order"].as_i64().unwrap_or(0),v["saved_at"].as_str()]).map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM protected_paths", []).map_err(|e| e.to_string())?;
    for p in &next.paths { tx.execute("INSERT INTO protected_paths (id,data) VALUES (?1,?2)", params![p["id"].as_str(),p.to_string()]).map_err(|e| e.to_string())?; }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn protection_snapshot(state: State<AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let s = snapshot(&conn)?;
    let mut value = serde_json::to_value(&s).map_err(|e| e.to_string())?;
    value["revision"] = json!(revision(&s));
    Ok(value)
}
#[tauri::command]
pub fn protected_paths_list(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    paths(&conn)
}
#[tauri::command]
pub fn protection_commit(state: State<AppState>, revision: String, data: ProtectionState) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    commit(&conn, &revision, &data)
}
