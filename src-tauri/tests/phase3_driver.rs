/// Phase 3 PR B — Op 路径回归测试。
///
/// PR B 删除旧 service 函数后，所有操作走 Op 路径。此测试验证：
/// 1. 时间戳精确往返
/// 2. 部分更新仅改指定字段
/// 3. IS NULL / IS NOT NULL 记录数对等
/// 4. 排序 + 软删除过滤
/// 5. includeDeleted 双向验证

use rusqlite::Connection;
use nine_rings_lib::db::query::{compile_op, Op};
use serde_json::json;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();
    conn
}

fn db_query(conn: &Connection, op_json: &str) -> Vec<serde_json::Value> {
    let op: Op = serde_json::from_str(op_json).unwrap();
    let (sql, params) = compile_op(&op).unwrap();
    let mut stmt = conn.prepare(&sql).unwrap();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let mut map = serde_json::Map::new();
        for (i, col_name) in row.as_ref().column_names().iter().enumerate() {
            let value: rusqlite::types::Value = row.get_unwrap(i);
            let json_val = match value {
                rusqlite::types::Value::Null => serde_json::Value::Null,
                rusqlite::types::Value::Integer(i) => json!(i),
                rusqlite::types::Value::Real(f) => json!(f),
                rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
                rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
            };
            map.insert(col_name.to_string(), json_val);
        }
        Ok(serde_json::Value::Object(map))
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

fn db_exec(conn: &Connection, op_json: &str) {
    let op: Op = serde_json::from_str(op_json).unwrap();
    let (sql, params) = compile_op(&op).unwrap();
    conn.execute(&sql, rusqlite::params_from_iter(params.iter())).unwrap();
}

fn create_note(conn: &Connection, id: &str, date: &str, title: &str, pinned: bool, storage_path: Option<&str>) {
    let sp_val = match storage_path {
        Some(p) => json!(p),
        None => serde_json::Value::Null,
    };
    let dt_val = if storage_path.is_some() { json!("how-to") } else { serde_json::Value::Null };
    let op = json!({
        "type": "insert",
        "table": "notes",
        "values": {
            "id": id,
            "date": date,
            "title": title,
            "content": "{\"ops\":[]}",
            "search_text": "",
            "tags": "[]",
            "pinned": if pinned { 1 } else { 0 },
            "sort_order": 0,
            "created_at": "2026-07-15T00:00:00Z",
            "updated_at": "2026-07-15T00:00:00Z",
            "storage_path": sp_val,
            "doc_type": dt_val,
            "concepts": "[]",
            "linked_doc_ids": "[]",
            "readonly": 0
        }
    });
    db_exec(conn, &op.to_string());
}

// ═══════════════════════════════════════════════════════════════════

#[test]
fn test_create_note_timestamp_roundtrip() {
    let conn = setup_db();

    let ts = "2026-07-15T12:30:45.123Z";
    let op = json!({
        "type": "insert",
        "table": "notes",
        "values": {
            "id": "ts-test",
            "date": "2026-07-15",
            "title": "TS",
            "content": "{\"ops\":[]}",
            "search_text": "",
            "tags": "[]",
            "pinned": 0,
            "sort_order": 0,
            "created_at": ts,
            "updated_at": ts,
            "storage_path": null,
            "doc_type": null,
            "concepts": "[]",
            "linked_doc_ids": "[]",
            "readonly": 0
        }
    });
    db_exec(&conn, &op.to_string());

    let rows = db_query(&conn, &json!({
        "type": "select", "table": "notes",
        "columns": ["id", "created_at", "updated_at"],
        "where": [{"col": "id", "op": "=", "val": "ts-test", "not": false}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["created_at"], ts);
    assert_eq!(rows[0]["updated_at"], ts);
}

#[test]
fn test_update_note_partial_fields() {
    let conn = setup_db();
    create_note(&conn, "upd-1", "2026-07-15", "Before", false, None);

    // 只改 title
    db_exec(&conn, &json!({
        "type": "update", "table": "notes",
        "set": {"title": "After", "updated_at": "2026-07-15T01:00:00Z"},
        "where": [
            {"col": "id", "op": "=", "val": "upd-1", "not": false},
            {"col": "deleted_at", "op": "IS", "val": null, "not": false}
        ]
    }).to_string());

    let rows = db_query(&conn, &json!({
        "type": "select", "table": "notes",
        "columns": ["id", "title", "pinned", "readonly", "tags"],
        "where": [{"col": "id", "op": "=", "val": "upd-1", "not": false}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(rows[0]["title"], "After");
    assert_eq!(rows[0]["pinned"], json!(0), "pinned unchanged");
    assert_eq!(rows[0]["readonly"], json!(0), "readonly unchanged");
}

#[test]
fn test_path_tree_record_counts() {
    let conn = setup_db();

    let ids: Vec<String> = (0..3).map(|i| format!("doc-{}", i)).collect();
    for id in &ids {
        create_note(&conn, id, "2026-07-20", &format!("Doc {}", id), false, Some(&format!("projects/g{}", id)));
    }
    for i in 0..2 {
        create_note(&conn, &format!("daily-{}", i), "2026-07-20", "Daily", false, None);
    }
    // soft-deleted doc
    create_note(&conn, "del-doc", "2026-07-20", "Deleted", false, Some("trash"));
    db_exec(&conn, &json!({
        "type": "update", "table": "notes",
        "set": {"deleted_at": "2026-07-20T00:00:00Z", "updated_at": "2026-07-20T00:00:00Z"},
        "where": [{"col": "id", "op": "=", "val": "del-doc", "not": false}]
    }).to_string());

    let docs = db_query(&conn, &json!({
        "type": "select", "table": "notes", "columns": ["id"],
        "where": [{"col": "storage_path", "op": "IS", "val": null, "not": true}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(docs.len(), 3, "3 doc notes (soft-deleted excluded)");

    let dailies = db_query(&conn, &json!({
        "type": "select", "table": "notes", "columns": ["id"],
        "where": [{"col": "storage_path", "op": "IS", "val": null, "not": false}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(dailies.len(), 2, "2 daily notes");

    let all = db_query(&conn, &json!({
        "type": "select", "table": "notes", "columns": ["id"],
        "includeDeleted": false
    }).to_string());
    assert_eq!(all.len(), 5, "total = 3 + 2");
}

#[test]
fn test_sort_and_soft_delete_filter() {
    let conn = setup_db();
    create_note(&conn, "a", "2026-07-15", "Alpha", false, None);
    create_note(&conn, "b", "2026-07-15", "Beta", true, None);
    create_note(&conn, "c", "2026-07-16", "Gamma", false, None);

    let rows = db_query(&conn, &json!({
        "type": "select", "table": "notes",
        "columns": ["id", "pinned"],
        "where": [{"col": "date", "op": "=", "val": "2026-07-15", "not": false}],
        "orderBy": [{"col": "pinned", "desc": true}, {"col": "sort_order", "desc": false}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], "b", "pinned first");
    assert_eq!(rows[1]["id"], "a");
}

#[test]
fn test_soft_delete_include_deleted() {
    let conn = setup_db();
    create_note(&conn, "sd-1", "2026-07-15", "ToDelete", false, None);

    db_exec(&conn, &json!({
        "type": "update", "table": "notes",
        "set": {"deleted_at": "2026-07-15T02:00:00Z", "updated_at": "2026-07-15T02:00:00Z"},
        "where": [{"col": "id", "op": "=", "val": "sd-1", "not": false}]
    }).to_string());

    let hidden = db_query(&conn, &json!({
        "type": "select", "table": "notes", "columns": ["id"],
        "where": [{"col": "id", "op": "=", "val": "sd-1", "not": false}],
        "includeDeleted": false
    }).to_string());
    assert!(hidden.is_empty());

    let visible = db_query(&conn, &json!({
        "type": "select", "table": "notes", "columns": ["id", "deleted_at"],
        "where": [{"col": "id", "op": "=", "val": "sd-1", "not": false}],
        "includeDeleted": true
    }).to_string());
    assert_eq!(visible.len(), 1);
    assert!(!visible[0]["deleted_at"].is_null());
}
