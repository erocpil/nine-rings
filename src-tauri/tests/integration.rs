/// 集成测试 — 使用通用 db_query/db_exec 的 Op 路径。
///
/// Phase 3 PR B 后，旧 service 函数已删除。所有测试改用 Op JSON。
/// FTS5 搜索、daily page、export 仍走旧路径（未迁移）。

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

fn make_todo(id: &str, text: &str, done: bool) -> nine_rings_lib::db::models::Todo {
    nine_rings_lib::db::models::Todo {
        id: id.into(), text: text.into(), done, order: 0, tags: vec![],
    }
}

fn create_note_via_op(conn: &Connection, id: &str, date: &str, title: &str, tags: &[&str]) {
    let op = json!({
        "type": "insert",
        "table": "notes",
        "values": {
            "id": id,
            "date": date,
            "title": title,
            "content": "{\"ops\":[{\"insert\":\"test\"}]}",
            "search_text": "test",
            "tags": serde_json::to_string(&tags).unwrap(),
            "pinned": 0,
            "sort_order": 0,
            "created_at": "2026-07-08T00:00:00Z",
            "updated_at": "2026-07-08T00:00:00Z",
            "storage_path": null,
            "doc_type": null,
            "concepts": "[]",
            "linked_doc_ids": "[]",
            "readonly": 0
        }
    });
    db_exec(conn, &op.to_string());
}

fn get_notes_by_date_via_op(conn: &Connection, date: &str) -> Vec<serde_json::Value> {
    let op = json!({
        "type": "select",
        "table": "notes",
        "columns": ["id", "title", "tags", "content"],
        "where": [{"col": "date", "op": "=", "val": date, "not": false}],
        "orderBy": [{"col": "pinned", "desc": true}, {"col": "sort_order", "desc": false}],
        "includeDeleted": false
    });
    db_query(conn, &op.to_string())
}

fn soft_delete_via_op(conn: &Connection, id: &str) {
    let op = json!({
        "type": "update",
        "table": "notes",
        "set": {"deleted_at": "2026-07-08T01:00:00Z", "updated_at": "2026-07-08T01:00:00Z"},
        "where": [{"col": "id", "op": "=", "val": id, "not": false}]
    });
    db_exec(conn, &op.to_string());
}

// ──── Export / Import ────

#[test]
fn test_export_roundtrip() {
    let conn = setup_db();

    create_note_via_op(&conn, "n1", "2026-07-08", "原始", &["work"]);

    let bundle = nine_rings_lib::export::export_all(&conn).unwrap();
    assert_eq!(bundle.notes.len(), 1);
    assert_eq!(bundle.notes[0].title.as_deref(), Some("原始"));
    assert_eq!(bundle.notes[0].tags, vec!["work"]);

    let conn2 = setup_db();
    let (n, p) = nine_rings_lib::export::import_bundle(&conn2, &bundle).unwrap();
    assert_eq!(n, 1);
    assert_eq!(p, 0);

    let notes = get_notes_by_date_via_op(&conn2, "2026-07-08");
    assert_eq!(notes.len(), 1);
}

#[test]
fn test_import_skips_duplicates() {
    let conn = setup_db();
    create_note_via_op(&conn, "dup-id", "2026-07-08", "A", &[]);

    // 再插入同 ID 的笔记：INSERT OR REPLACE 会覆盖
    // 用 Op 直接插入同 ID
    let op = json!({
        "type": "insert",
        "table": "notes",
        "values": {
            "id": "dup-id",
            "date": "2026-07-08",
            "title": "A v2",
            "content": "{\"ops\":[]}",
            "search_text": "",
            "tags": "[]",
            "pinned": 0, "sort_order": 0,
            "created_at": "2026-07-08T00:00:00Z",
            "updated_at": "2026-07-08T00:00:00Z",
            "storage_path": null, "doc_type": null,
            "concepts": "[]", "linked_doc_ids": "[]", "readonly": 0
        },
        "onConflict": "replace"
    });
    db_exec(&conn, &op.to_string());

    let rows = db_query(&conn, &json!({
        "type": "select", "table": "notes",
        "columns": ["id", "title"],
        "where": [{"col": "id", "op": "=", "val": "dup-id", "not": false}],
        "includeDeleted": false
    }).to_string());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["title"], "A v2", "INSERT OR REPLACE overwrote title");
}

// ──── Recycle Bin ────

#[test]
fn test_soft_delete_and_list_deleted() {
    let conn = setup_db();

    create_note_via_op(&conn, "del-1", "2026-07-08", "待删除", &[]);
    soft_delete_via_op(&conn, "del-1");

    // 不在正常查询中
    let notes = get_notes_by_date_via_op(&conn, "2026-07-08");
    assert!(notes.is_empty());

    // 在回收站中 — 用 Op includeDeleted 查询
    let deleted_rows = db_query(&conn, &json!({
        "type": "select",
        "table": "notes",
        "columns": ["id"],
        "includeDeleted": true,
        "where": [{"col": "deleted_at", "op": "IS", "val": null, "not": true}]
    }).to_string());
    assert_eq!(deleted_rows.len(), 1);
    assert_eq!(deleted_rows[0]["id"], "del-1");
}

#[test]
fn test_restore_note() {
    let conn = setup_db();

    create_note_via_op(&conn, "restore-1", "2026-07-08", "恢复我", &[]);
    soft_delete_via_op(&conn, "restore-1");

    // 恢复
    conn.execute("UPDATE notes SET deleted_at = NULL WHERE id = ?1", rusqlite::params!["restore-1"]).unwrap();

    let notes = get_notes_by_date_via_op(&conn, "2026-07-08");
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0]["title"], "恢复我");
}

// ──── Daily Page (旧路径，未迁移) ────

#[test]
fn test_carryover_inherits_incomplete() {
    let conn = setup_db();
    let day1 = vec![make_todo("a", "未完成A", false), make_todo("b", "已完成B", true)];
    nine_rings_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, true).unwrap();
    let day2 = nine_rings_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert_eq!(day2.todos.len(), 1);
    assert_eq!(day2.todos[0].text, "未完成A");
    assert!(day2.todo_carryover);
}

#[test]
fn test_no_carryover_when_disabled() {
    let conn = setup_db();
    let day1 = vec![make_todo("x", "不会继承", false)];
    nine_rings_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, false).unwrap();
    let day2 = nine_rings_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert!(day2.todos.is_empty());
    assert!(!day2.todo_carryover);
}
