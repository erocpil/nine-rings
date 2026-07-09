use rusqlite::Connection;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();
    conn
}

fn make_todo(id: &str, text: &str, done: bool) -> nine_rings_lib::db::models::Todo {
    nine_rings_lib::db::models::Todo {
        id: id.into(), text: text.into(), done, order: 0, tags: vec![],
    }
}

// ──── Export / Import ────

#[test]
fn test_export_roundtrip() {
    let conn = setup_db();

    nine_rings_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("原始"), &serde_json::json!({"ops": [{"insert": "test"}]}),
        &["work".into()], false,
    ).unwrap();

    let bundle = nine_rings_lib::export::export_all(&conn).unwrap();
    assert_eq!(bundle.notes.len(), 1);
    assert_eq!(bundle.notes[0].title.as_deref(), Some("原始"));
    assert_eq!(bundle.notes[0].tags, vec!["work"]);

    // 导入到新数据库
    let conn2 = setup_db();
    let (n, p) = nine_rings_lib::export::import_bundle(&conn2, &bundle).unwrap();
    assert_eq!(n, 1);
    assert_eq!(p, 0);

    let notes = nine_rings_lib::service::note_service::get_notes_by_date(&conn2, "2026-07-08").unwrap();
    assert_eq!(notes.len(), 1);
}

#[test]
fn test_import_skips_duplicates() {
    let conn = setup_db();
    let n1 = nine_rings_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("A"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();

    // 尝试导入同样的 id（已存在）
    let bundle = nine_rings_lib::export::ExportBundle {
        version: 1,
        exported_at: "".into(),
        notes: vec![n1],
        daily_pages: vec![],
    };
    let (n, _) = nine_rings_lib::export::import_bundle(&conn, &bundle).unwrap();
    assert_eq!(n, 0, "should skip existing note");
}

// ──── Recycle Bin ────

#[test]
fn test_soft_delete_and_list_deleted() {
    let conn = setup_db();

    let note = nine_rings_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("待删除"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();

    // 软删除
    nine_rings_lib::service::note_service::delete_note(&conn, &note.id).unwrap();

    // 不在正常查询中
    let notes = nine_rings_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert!(notes.is_empty());

    // 在回收站中
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes WHERE deleted_at IS NOT NULL"
    ).unwrap();
    let deleted: Vec<_> = stmt.query_map([], |row| nine_rings_lib::db::models::note_from_row(row))
        .unwrap().filter_map(|r| r.ok()).collect();
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0].id, note.id);
}

#[test]
fn test_restore_note() {
    let conn = setup_db();

    let note = nine_rings_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("恢复我"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();

    nine_rings_lib::service::note_service::delete_note(&conn, &note.id).unwrap();

    // 恢复
    let conn_ref = &conn;
    conn_ref.execute("UPDATE notes SET deleted_at = NULL WHERE id = ?1", rusqlite::params![note.id]).unwrap();

    let notes = nine_rings_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].title.as_deref(), Some("恢复我"));
}

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
