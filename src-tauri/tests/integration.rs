use rusqlite::Connection;

/// 创建内存数据库并跑 Migration
fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    note_sticky_lib::db::migrations::run(&conn).unwrap();
    conn
}

// ──── Note CRUD ────

#[test]
fn test_create_and_list_notes() {
    let conn = setup_db();

    let note = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("测试标题"), &serde_json::json!({"ops": [{"insert": "Hello"}]}),
    )
    .unwrap();

    assert_eq!(note.title.as_deref(), Some("测试标题"));
    assert_eq!(note.date, "2026-07-08");

    let notes = note_sticky_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, note.id);
}

#[test]
fn test_update_note() {
    let conn = setup_db();

    let note = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("旧标题"), &serde_json::json!({"ops": []}),
    )
    .unwrap();

    let updated = note_sticky_lib::service::note_service::update_note(
        &conn, &note.id, Some("新标题"), &serde_json::json!({"ops": [{"insert": "Updated"}]}),
    )
    .unwrap()
    .unwrap();

    assert_eq!(updated.title.as_deref(), Some("新标题"));
    assert_ne!(updated.updated_at, note.updated_at);
}

#[test]
fn test_delete_note_soft() {
    let conn = setup_db();

    let note = note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("待删除"), &serde_json::json!({"ops": []}),
    )
    .unwrap();

    note_sticky_lib::service::note_service::delete_note(&conn, &note.id).unwrap();

    // 软删除后 list 不应返回
    let notes = note_sticky_lib::service::note_service::get_notes_by_date(&conn, "2026-07-08").unwrap();
    assert!(notes.is_empty());
}

#[test]
fn test_search_notes() {
    let conn = setup_db();

    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-08", Some("Alpha"), &serde_json::json!({"ops": [{"insert": "Hello world"}]}),
    )
    .unwrap();
    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-09", Some("Beta"), &serde_json::json!({"ops": [{"insert": "Rust programming"}]}),
    )
    .unwrap();

    let results = note_sticky_lib::service::note_service::search_notes(&conn, "Rust").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title.as_deref(), Some("Beta"));
}

#[test]
fn test_search_multidate() {
    let conn = setup_db();

    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-02", Some("牛奶"), &serde_json::json!({"ops": [{"insert": "喝牛奶"}]}),
    )
    .unwrap();
    note_sticky_lib::service::note_service::create_note(
        &conn, "2026-07-03", Some("过敏"), &serde_json::json!({"ops": [{"insert": "买豆浆代替喝牛奶"}]}),
    )
    .unwrap();

    // 短语搜索 "牛奶" 在 tokenchars 模式下匹配相邻 tokens "牛"+"奶"
    let results = note_sticky_lib::service::note_service::search_notes(&conn, "牛奶").unwrap();
    assert_eq!(results.len(), 2, "should match both notes containing '牛奶'");
}

// ──── DailyPage / Carryover ────

#[test]
fn test_get_or_create_daily_page_empty() {
    let conn = setup_db();

    // 不存在页面时自动创建空页面
    let page = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-08").unwrap();
    assert_eq!(page.date, "2026-07-08");
    assert!(page.todos.is_empty());
    assert!(!page.todo_carryover);
}

#[test]
fn test_get_or_create_daily_page_existing() {
    let conn = setup_db();

    // 先更新创建
    let todos = vec![
        note_sticky_lib::db::models::Todo { id: "t1".into(), text: "任务1".into(), done: false, order: 0 },
    ];
    note_sticky_lib::service::note_service::update_todos(&conn, "2026-07-08", &todos, false).unwrap();

    // 再次获取应返回已有页面
    let page = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-08").unwrap();
    assert_eq!(page.todos.len(), 1);
    assert_eq!(page.todos[0].text, "任务1");
}

#[test]
fn test_carryover_inherits_incomplete() {
    let conn = setup_db();

    // 第1天: 2个待办, 1个完成, 开启 carryover
    let day1 = vec![
        note_sticky_lib::db::models::Todo { id: "a".into(), text: "未完成A".into(), done: false, order: 0 },
        note_sticky_lib::db::models::Todo { id: "b".into(), text: "已完成B".into(), done: true, order: 1 },
    ];
    note_sticky_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, true).unwrap();

    // 第2天: 自动继承未完成的"未完成A"
    let day2 = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert_eq!(day2.todos.len(), 1);
    assert_eq!(day2.todos[0].text, "未完成A");
    assert!(!day2.todos[0].done);
    assert!(day2.todo_carryover);  // 标记被继承
}

#[test]
fn test_no_carryover_when_disabled() {
    let conn = setup_db();

    // 第1天: 有待办但 carryover=false
    let day1 = vec![
        note_sticky_lib::db::models::Todo { id: "x".into(), text: "不会继承".into(), done: false, order: 0 },
    ];
    note_sticky_lib::service::note_service::update_todos(&conn, "2026-07-01", &day1, false).unwrap();

    // 第2天: 空页面
    let day2 = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-02").unwrap();
    assert!(day2.todos.is_empty());
    assert!(!day2.todo_carryover);
}

#[test]
fn test_carryover_toggle_off_stops_inherit() {
    let conn = setup_db();

    // 第1天: 开启
    note_sticky_lib::service::note_service::update_todos(
        &conn, "2026-07-01", &[], true,
    ).unwrap();

    // 第2天: 关闭
    note_sticky_lib::service::note_service::update_todos(
        &conn, "2026-07-02", &[], false,
    ).unwrap();

    // 第3天: 不应继承（前一天的 carryover = false）
    let day3 = note_sticky_lib::service::note_service::get_or_create_daily_page(&conn, "2026-07-03").unwrap();
    assert!(!day3.todo_carryover);
}
