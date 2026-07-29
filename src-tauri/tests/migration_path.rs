/// 数据库迁移路径测试 — 验证新旧数据库均能正确升级到当前 schema (v7)。
/// 历史版本使用对应发布提交中冻结的真实 DDL fixture。
use rusqlite::Connection;
use std::collections::BTreeSet;

const SCHEMA_V2: &str = include_str!("fixtures/schema_v2.sql");
const SCHEMA_V3: &str = include_str!("fixtures/schema_v3.sql");
const SCHEMA_V4: &str = include_str!("fixtures/schema_v4.sql");
const SCHEMA_V5: &str = include_str!("fixtures/schema_v5.sql");

fn schema_columns(conn: &Connection) -> BTreeSet<(String, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type='table'
               AND name != '_schema_version'
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'notes_fts_%'",
        )
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    let mut result = BTreeSet::new();
    for table in tables {
        let mut columns = conn
            .prepare(&format!("PRAGMA table_info('{table}')"))
            .unwrap();
        for column in columns
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
        {
            result.insert((table.clone(), column.unwrap()));
        }
    }
    result
}

fn schema_indexes(conn: &Connection) -> BTreeSet<(String, String, Vec<String>)> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type='table'
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'notes_fts_%'",
        )
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    let mut result = BTreeSet::new();
    for table in tables {
        let mut indexes = conn
            .prepare(&format!("PRAGMA index_list('{table}')"))
            .unwrap();
        let names: Vec<String> = indexes
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for name in names
            .into_iter()
            .filter(|name| !name.starts_with("sqlite_"))
        {
            let mut info = conn
                .prepare(&format!("PRAGMA index_info('{name}')"))
                .unwrap();
            let columns = info
                .query_map([], |row| row.get::<_, String>(2))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            result.insert((table.clone(), name, columns));
        }
    }
    result
}

fn schema_foreign_keys(conn: &Connection) -> BTreeSet<(String, String, String, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type='table'
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'notes_fts_%'",
        )
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    let mut result = BTreeSet::new();
    for table in tables {
        let mut foreign_keys = conn
            .prepare(&format!("PRAGMA foreign_key_list('{table}')"))
            .unwrap();
        for item in foreign_keys
            .query_map([], |row| {
                Ok((
                    table.clone(),
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .unwrap()
        {
            result.insert(item.unwrap());
        }
    }
    result
}

fn assert_matches_fresh_schema(migrated: &Connection) {
    let fresh = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&fresh).unwrap();

    assert_eq!(schema_columns(migrated), schema_columns(&fresh));
    assert_eq!(schema_indexes(migrated), schema_indexes(&fresh));
    assert_eq!(schema_foreign_keys(migrated), schema_foreign_keys(&fresh));
}

fn assert_current_version(conn: &Connection) {
    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, 7);
}

fn assert_fts_hit(conn: &Connection, query: &str) {
    let hits: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?1",
            [query],
            |row| row.get(0),
        )
        .unwrap();
    assert!(hits > 0, "expected FTS hit for {query}");
}

// ── 场景 1：全新数据库（SCHEMA_DDL 驱动，migrations 标记 v7）──────────
#[test]
fn fresh_database_creates_full_schema() {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // 验证版本号
    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 7, "fresh database should be at version 7");

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

    // 验证版本号到 v7
    let version: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 7);
}

// ── 场景 3：含 _schema_version 但停在 v1 的旧库──────────
#[test]
fn migrate_from_v1_to_v7() {
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
    assert_eq!(version, 7);
}

// ── 场景 4：重复迁移幂等性（已到 v7 再跑不报错）──────────
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
            "SELECT COUNT(*) FROM _schema_version WHERE version=7",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "version 7 should not be duplicated");
}

// ── 场景 5：真实发布版 v5 fixture ──────────
#[test]
fn migrate_from_v5_to_v7() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_V5).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();
    assert_current_version(&conn);
    assert_matches_fresh_schema(&conn);
    assert_fts_hit(&conn, "legacy");

    let template_name: String = conn
        .query_row(
            "SELECT name FROM templates WHERE id='v5-template'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(template_name, "历史模板");

    let version_title: String = conn
        .query_row(
            "SELECT title FROM note_versions WHERE id='v5-version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version_title, "v5 snapshot");
}

// ── 场景 6：v5 后期触发器状态下，空笔记首次写正文不会损坏 FTS──────────
#[test]
fn migrate_v5_repairs_empty_note_fts_transition() {
    let conn = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();
    conn.execute("DELETE FROM _schema_version WHERE version IN (6, 7)", [])
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
    assert_current_version(&conn);
    assert_matches_fresh_schema(&conn);

    conn.execute(
        "UPDATE notes SET content='{\"ops\":[{\"insert\":\"hello\"}]}', search_text='hello'
         WHERE id='blank-1'",
        [],
    )
    .unwrap();
    assert_fts_hit(&conn, "hello");

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

// ── 场景 7：含数据的完整旧库迁移后 CRUD 操作正常──────────
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

// ── 场景 8：真实发布版 v2 fixture ──────────
#[test]
fn migrate_from_v2_to_v7() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_V2).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();
    assert_current_version(&conn);
    assert_matches_fresh_schema(&conn);
    assert_fts_hit(&conn, "legacy");

    let (tags, pinned, sort_order): (String, i32, i32) = conn
        .query_row(
            "SELECT tags, pinned, sort_order FROM notes WHERE id='v2-note'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(tags, "[\"tag1\"]");
    assert_eq!(pinned, 1);
    assert_eq!(sort_order, 5);

    let todos: String = conn
        .query_row(
            "SELECT todos FROM daily_pages WHERE date='2026-05-01'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(todos.contains("legacy todo"));
}

// ── 场景 9：真实发布版 v3 fixture ──────────
#[test]
fn migrate_from_v3_to_v7() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_V3).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();
    assert_current_version(&conn);
    assert_matches_fresh_schema(&conn);
    assert_fts_hit(&conn, "legacy");

    let ver_title: String = conn
        .query_row(
            "SELECT title FROM note_versions WHERE id='ver-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ver_title, "v3 v1");
}

// ── 场景 10：真实发布版 v4 fixture ──────────
#[test]
fn migrate_from_v4_to_v7() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_V4).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();
    assert_current_version(&conn);
    assert_matches_fresh_schema(&conn);
    assert_fts_hit(&conn, "legacy");

    let concepts: String = conn
        .query_row("SELECT concepts FROM notes WHERE id='v4-doc'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(concepts, "[\"rust\",\"db\"]");

    let linked: String = conn
        .query_row(
            "SELECT linked_doc_ids FROM notes WHERE id='v4-doc'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked, "[\"v4-note-2\"]");

    let version_title: String = conn
        .query_row(
            "SELECT title FROM note_versions WHERE id='v4-version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version_title, "v4 snapshot");
}
