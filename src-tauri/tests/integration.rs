use rusqlite::Connection;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    note_sticky_lib::db::migrations::run(&conn).unwrap();
    conn
}

fn make_todo(id: &str, text: &str, done: bool) -> note_sticky_lib::db::models::Todo {
    note_sticky_lib::db::models::Todo {
        id: id.into(),
        text: text.into(),
        done,
        order: 0,
        tags: vec![],
    }
}

// ──── Note CRUD ────

#[test]
fn test_create_and_list_notes() {
    let conn = setup_db();

    let note = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("测试"), &serde_json::json!({"ops": [{"insert": "Hello"}]}),
        &["tag1".into(), "tag2".into()], false,
    )
    .unwrap();

    assert_eq!(note.title.as_deref(), Some("测试"));
    assert_eq!(note.tags, vec!["tag1", "tag2"]);
    assert!(!note.pinned);
    assert_eq!(note.sort_order, 0);

    let notes = note_sticky_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert_eq!(notes.len(), 1);
}

#[test]
fn test_create_pinned_note_first() {
    let conn = setup_db();

    // pinned 笔记排在前面
    let _a = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("普通"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();
    let b = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("置顶"), &serde_json::json!({"ops": []}),
        &[], true,
    ).unwrap();

    let notes = note_sticky_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert_eq!(notes[0].id, b.id, "pinned note should be first");
    assert!(notes[0].pinned);
}

#[test]
fn test_search_tags() {
    let conn = setup_db();

    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("A"), &serde_json::json!({"ops": []}),
        &["work".into(), "dev".into()], false,
    ).unwrap();
    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("B"), &serde_json::json!({"ops": []}),
        &["personal".into()], false,
    ).unwrap();

    let work = note_sticky_lib::service::note_service::get_notes_by_tag(&conn, "work").unwrap();
    assert_eq!(work.len(), 1);
    assert_eq!(work[0].title.as_deref(), Some("A"));

    let personal = note_sticky_lib::service::note_service::get_notes_by_tag(&conn, "personal").unwrap();
    assert_eq!(personal.len(), 1);

    let all_tags = note_sticky_lib::service::note_service::get_all_tags(&conn).unwrap();
    assert_eq!(all_tags.len(), 3);
    assert!(all_tags.contains(&"work".to_string()));
    assert!(all_tags.contains(&"dev".to_string()));
    assert!(all_tags.contains(&"personal".to_string()));
}

#[test]
fn test_reorder_note() {
    let conn = setup_db();

    let a = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("A"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();
    let b = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("B"), &serde_json::json!({"ops": []}),
        &[], false,
    ).unwrap();

    // 交换顺序
    note_sticky_lib::service::note_service::reorder_note(&conn, &a.id, 1).unwrap();
    note_sticky_lib::service::note_service::reorder_note(&conn, &b.id, 0).unwrap();

    let notes = note_sticky_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert_eq!(notes[0].id, b.id);
    assert_eq!(notes[0].sort_order, 0);
    assert_eq!(notes[1].id, a.id);
}

// ──── 原有测试 ────

#[test]
fn test_carryover_inherits_incomplete() {
    let conn = setup_db();

    let day1 = vec![
        make_todo("a", "未完成A", false),
        make_todo("b", "已完成B", true),
    ];
    note_sticky_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, true).unwrap();

    let day2 = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert_eq!(day2.todos.len(), 1);
    assert_eq!(day2.todos[0].text, "未完成A");
    assert!(day2.todo_carryover);
}

#[test]
fn test_no_carryover_when_disabled() {
    let conn = setup_db();

    let day1 = vec![make_todo("x", "不会继承", false)];
    note_sticky_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, false).unwrap();

    let day2 = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert!(day2.todos.is_empty());
    assert!(!day2.todo_carryover);
}
