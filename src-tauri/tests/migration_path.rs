/// 数据库迁移路径测试 — 验证新旧数据库均能正确升级到当前 schema (v6)。
/// 覆盖三种场景：全新建库、从 v0 迁移、从各中间版本推进。
use rusqlite::Connection;

// ── 场景 1：全新数据库（SCHEMA_DDL 驱动，migrations 标记 v6）──────────
#[test]
fn fresh_database_creates_full_schema() {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 验证版本号
    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6, "fresh database should be at version 6");

    // 验证所有表存在
    for table in &[
        "notes",
        "daily_pages",
        "note_versions",
        "sync_changes",
        "templates",
    ] {
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert!(count > 0, "table {} should exist", table);
    }

    // 验证 notes 表包含 snake_case 列（Schema 4B 对齐后）
    let columns: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info('notes') ORDER BY cid")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.filter_map(|r| r.ok()).collect()
    };
    assert!(
        columns.contains(&"storage_path".to_string()),
        "storage_path column missing"
    );
    assert!(
        columns.contains(&"doc_type".to_string()),
        "doc_type column missing"
    );
}

// ── 场景 2：最小 v0 数据库（手动建表，无 _schema_version）──────────
#[test]
fn migrate_from_v0_minimal_notes() {
    let conn = Connection::open_in_memory().unwrap();

    // 模拟 v0 数据库：只有 notes 表的基础字段
    conn.execute_batch(
        "CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        INSERT INTO notes(id, date, title, content, created_at, updated_at)
        VALUES ('note-1', '2026-01-15', '测试笔记', '{\"ops\":[]}', '2026-01-15T08:00:00Z', '2026-01-15T08:00:00Z');",
    )
    .unwrap();

    // 运行迁移
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 验证数据不丢
    let title: String = conn
        .query_row("SELECT title FROM notes WHERE id='note-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title, "测试笔记");

    // 验证新列存在且为默认值
    let tags: String = conn
        .query_row("SELECT tags FROM notes WHERE id='note-1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(tags, "[]");

    let readonly: i32 = conn
        .query_row("SELECT readonly FROM notes WHERE id='note-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(readonly, 0);

    // 验证版本号到 v6
    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6);
}

// ── 场景 3：含 _schema_version 但停在 v1 的旧库──────────
#[test]
fn migrate_from_v1_to_v6() {
    let conn = Connection::open_in_memory().unwrap();

    // v1 建表（假设已有 _schema_version = 1）
    conn.execute_batch(
        "CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
         INSERT INTO _schema_version VALUES (1);
         CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL DEFAULT '{}',
            search_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
         );
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at)
         VALUES ('note-a', '2026-02-20', 'v1 笔记', '{}', 'v1 content', '2026-02-20T00:00:00Z', '2026-02-20T00:00:00Z');",
    )
    .unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // v2 列 (tags, pinned, sort_order) 已添加
    let pinned: i32 = conn
        .query_row("SELECT pinned FROM notes WHERE id='note-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(pinned, 0);

    // v4 列 (storage_path, doc_type, concepts, linked_doc_ids, readonly)
    let concepts: String = conn
        .query_row("SELECT concepts FROM notes WHERE id='note-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(concepts, "[]");

    // templates 表 (v5) 存在
    let template_count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='templates'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(template_count, 1);

    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6);
}

// ── 场景 4：重复迁移幂等性（已到 v6 再跑不报错）──────────
#[test]
fn migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 写入数据后再次运行迁移
    conn.execute_batch(
        "INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at)
         VALUES ('idem-1', '2026-03-01', '幂等测试', '{}', '', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');",
    )
    .unwrap();

    // 第二次 migrate 不应报错
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 数据完好
    let title: String = conn
        .query_row("SELECT title FROM notes WHERE id='idem-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title, "幂等测试");

    // _schema_version 不应重复插入
    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM _schema_version WHERE version=6",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "version 6 should not be duplicated");
}

// ── 场景 5：v5 旧库升级后，空笔记首次写入正文不会损坏 FTS──────────
#[test]
fn migrate_v5_repairs_empty_note_fts_transition() {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 模拟已经发布的 v5：旧触发器跳过空 INSERT，却无条件删除旧索引。
    conn.execute("DELETE FROM _schema_version WHERE version = 6", [])
        .unwrap();
    conn.execute_batch(
        "DROP TRIGGER notes_ai;
         DROP TRIGGER notes_ad;
         DROP TRIGGER notes_au;
         CREATE TRIGGER notes_ai AFTER INSERT ON notes
         WHEN new.search_text != '' BEGIN
            INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
         END;
         CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text)
            VALUES ('delete', old.rowid, old.search_text);
         END;
         CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text)
            VALUES ('delete', old.rowid, old.search_text);
            INSERT INTO notes_fts(rowid, search_text)
            SELECT new.rowid, new.search_text WHERE new.search_text != '';
         END;",
    )
    .unwrap();

    conn.execute(
        "INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at)
         VALUES ('blank-1', '2026-07-29', '空白笔记', '{}', '', '2026-07-29T00:00:00Z', '2026-07-29T00:00:00Z')",
        [],
    )
    .unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    conn.execute(
        "UPDATE notes SET content='{\"ops\":[{\"insert\":\"hello\"}]}', search_text='hello'
         WHERE id='blank-1'",
        [],
    )
    .unwrap();

    let hits: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'hello'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1);

    conn.execute("DELETE FROM notes WHERE id='blank-1'", [])
        .unwrap();
    let integrity = conn.execute(
        "INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')",
        [],
    );
    assert!(
        integrity.is_ok(),
        "FTS integrity-check failed: {integrity:?}"
    );
}

// ── 场景 6：含数据的完整旧库迁移后 CRUD 操作正常──────────
#[test]
fn old_database_crud_after_migration() {
    let conn = Connection::open_in_memory().unwrap();

    // 旧 schema
    conn.execute_batch(
        "CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL DEFAULT '{}',
            search_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
         );
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at)
         VALUES ('crud-1', '2026-04-01', 'CRUD 测试', '{\"ops\":[{\"insert\":\"hello\"}]}', 'hello', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');",
    )
    .unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // UPDATE
    conn.execute(
        "UPDATE notes SET title=?1, updated_at=?2 WHERE id='crud-1'",
        ["更新后的标题", "2026-04-02T00:00:00Z"],
    )
    .unwrap();

    let title: String = conn
        .query_row("SELECT title FROM notes WHERE id='crud-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title, "更新后的标题");

    // INSERT 新笔记（使用 snake_case 列名）
    conn.execute(
        "INSERT INTO notes(id, date, title, content, search_text, storage_path, doc_type, created_at, updated_at)
         VALUES ('crud-2', '2026-04-15', '新笔记', '{}', '', '/docs/new', 'essay', '2026-04-15T00:00:00Z', '2026-04-15T00:00:00Z')",
        [],
    )
    .unwrap();

    let sp: String = conn
        .query_row(
            "SELECT storage_path FROM notes WHERE id='crud-2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sp, "/docs/new");

    // DELETE (软删除)
    conn.execute(
        "UPDATE notes SET deleted_at='2026-04-16T00:00:00Z' WHERE id='crud-1'",
        [],
    )
    .unwrap();

    let active_count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(active_count, 1);
}
