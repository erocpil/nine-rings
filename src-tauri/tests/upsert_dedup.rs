/// upsert_note_dedup 集成测试 — 验证「查重 + 写入」的原子语义与匹配谓词。
///
/// 覆盖：
/// 1. 文档 upsert：同 storagePath+title 命中 → 更新而非新建（id 不变）
/// 2. 随笔 upsert：同 title+date 命中 → 更新而非新建
/// 3. 显式 id（导入透传）→ 直接用，不查重
/// 4. 多命中确定性：updated_at DESC, id ASC 取首条
/// 5. 命中保留旧元数据（created_at / sort_order / readonly）
/// 6. 无匹配 → 新建
use nine_rings_lib::db::models::{upsert_note_dedup, UpsertNoteInput};
use rusqlite::Connection;
use serde_json::json;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();
    conn
}

fn input(date: &str, title: Option<&str>, storage_path: Option<&str>) -> UpsertNoteInput {
    UpsertNoteInput {
        date: date.to_string(),
        title: title.map(|s| s.to_string()),
        content: Some(json!({ "ops": [{"insert": "hello"}] })),
        tags: Some(vec![]),
        pinned: Some(false),
        storage_path: storage_path.map(|s| s.to_string()),
        doc_type: None,
        concepts: Some(vec![]),
        linked_doc_ids: Some(vec![]),
        search_text: Some("hello".to_string()),
        id: None,
        created_at: None,
        updated_at: None,
        readonly: None,
        sort_order: None,
    }
}

fn count_notes(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
}

#[test]
fn doc_upsert_updates_instead_of_inserting() {
    let mut conn = setup_db();
    let a = upsert_note_dedup(
        &mut conn,
        &input("2026-08-01", Some("标题A"), Some("projects/x")),
    )
    .unwrap();
    let b = upsert_note_dedup(
        &mut conn,
        &input("2026-08-01", Some("标题A"), Some("projects/x")),
    )
    .unwrap();
    assert_eq!(a.id, b.id, "同 storagePath+title 应命中同一笔记");
    assert_eq!(count_notes(&conn), 1);
}

#[test]
fn daily_upsert_updates_instead_of_inserting() {
    let mut conn = setup_db();
    let a = upsert_note_dedup(&mut conn, &input("2026-08-01", Some("日记"), None)).unwrap();
    let b = upsert_note_dedup(&mut conn, &input("2026-08-01", Some("日记"), None)).unwrap();
    assert_eq!(a.id, b.id, "同 title+date 应命中同一随笔");
    assert_eq!(count_notes(&conn), 1);
}

#[test]
fn explicit_id_bypasses_dedup() {
    let mut conn = setup_db();
    let mut d = input("2026-08-01", Some("标题"), Some("projects/x"));
    d.id = Some("explicit-id".to_string());
    let note = upsert_note_dedup(&mut conn, &d).unwrap();
    assert_eq!(note.id, "explicit-id");
    assert_eq!(count_notes(&conn), 1);
}

#[test]
fn multiple_matches_pick_latest_updated_then_lowest_id() {
    let mut conn = setup_db();
    // 插入两条同 storagePath+title 的笔记（模拟历史脏数据）
    for (id, updated) in [
        ("doc-old", "2026-01-01T00:00:00.000Z"),
        ("doc-new", "2026-06-01T00:00:00.000Z"),
    ] {
        conn.execute(
            "INSERT INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
             VALUES (?1, '2026-08-01', '同标题', '{\"ops\":[]}', '', '[]', 0, 0, '2026-01-01T00:00:00.000Z', ?2, 'projects/x', NULL, '[]', '[]', 0)",
            rusqlite::params![id, updated],
        )
        .unwrap();
    }
    // upsert 命中时应选 updated_at 最新的 doc-new
    let note = upsert_note_dedup(
        &mut conn,
        &input("2026-08-01", Some("同标题"), Some("projects/x")),
    )
    .unwrap();
    assert_eq!(note.id, "doc-new");
}

#[test]
fn hit_preserves_metadata() {
    let mut conn = setup_db();
    // 预置一条 readonly=1, sort_order=7 的文档
    conn.execute(
        "INSERT INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
         VALUES ('keep-meta', '2026-08-01', '元数据', '{\"ops\":[]}', '', '[]', 0, 7, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'projects/x', NULL, '[]', '[]', 1)",
        [],
    )
    .unwrap();
    let note = upsert_note_dedup(
        &mut conn,
        &input("2026-08-01", Some("元数据"), Some("projects/x")),
    )
    .unwrap();
    assert_eq!(note.id, "keep-meta");
    assert_eq!(note.sort_order, 7, "命中应保留 sort_order");
    assert!(note.readonly, "命中应保留 readonly");
    assert_eq!(
        note.created_at, "2026-01-01T00:00:00.000Z",
        "命中应保留 created_at"
    );
}

#[test]
fn no_match_creates_new() {
    let mut conn = setup_db();
    let note = upsert_note_dedup(
        &mut conn,
        &input("2026-08-01", Some("新笔记"), Some("projects/x")),
    )
    .unwrap();
    assert!(!note.id.is_empty());
    assert_eq!(count_notes(&conn), 1);
}

#[test]
fn explicit_id_preserves_import_metadata() {
    let mut conn = setup_db();
    let mut d = input("2026-08-01", Some("导入文档"), Some("projects/x"));
    d.id = Some("import-id".to_string());
    d.readonly = Some(true);
    d.sort_order = Some(5);
    d.created_at = Some("2026-01-01T00:00:00.000Z".to_string());
    let note = upsert_note_dedup(&mut conn, &d).unwrap();
    assert_eq!(note.id, "import-id");
    assert!(note.readonly, "导入透传应保留 readonly");
    assert_eq!(note.sort_order, 5, "导入透传应保留 sort_order");
    assert_eq!(
        note.created_at, "2026-01-01T00:00:00.000Z",
        "导入透传应保留 created_at"
    );
}
