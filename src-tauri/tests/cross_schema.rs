/// 跨端存储行为测试: fresh DB (SCHEMA_DDL) vs migrated DB
///
/// 验证两个关键断言:
/// 1. 全新建库和从历史版本迁移得到等价 Schema
/// 2. 两个库插入相同 fixture 后读写行为一致
use rusqlite::{params, Connection};
use std::collections::BTreeSet;

use nine_rings_lib::db;
use nine_rings_lib::db::schema_gen::SCHEMA_DDL;

// ── Helpers ──

/// 提取表名→列名集合的映射
fn table_columns(conn: &Connection) -> BTreeSet<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_schema_version' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_fts_%'")
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut cols = BTreeSet::new();
    for t in &tables {
        let mut s = conn
            .prepare(&format!("PRAGMA table_info('{}')", t))
            .unwrap();
        let cids: Vec<String> = s
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        for c in cids {
            cols.insert((t.clone(), c));
        }
    }
    cols
}

/// 提取表名→索引名集合
fn table_indexes(conn: &Connection) -> BTreeSet<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut idxs = BTreeSet::new();
    for t in &tables {
        let mut s = conn
            .prepare(&format!("PRAGMA index_list('{}')", t))
            .unwrap();
        let names: Vec<String> = s
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .filter(|n| !n.starts_with("sqlite_"))
            .collect();
        for n in names {
            idxs.insert((t.clone(), n));
        }
    }
    idxs
}

// ── Fresh DB ──

fn fresh_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    // 执行 SCHEMA_DDL
    for ddl in SCHEMA_DDL {
        conn.execute_batch(ddl).unwrap();
    }
    // search_text 列由 migrate_v1 补加，不在 SCHEMA_DDL 中
    conn.execute_batch("ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT '';")
        .unwrap();
    // 补充 FTS 触发器（SCHEMA_DDL 不包含）
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS notes_ai;
         DROP TRIGGER IF EXISTS notes_ad;
         DROP TRIGGER IF EXISTS notes_au;
         CREATE TRIGGER notes_ai AFTER INSERT ON notes
         WHEN new.search_text != '' BEGIN
            INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
         END;
         CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
         END;
         CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
            INSERT INTO notes_fts(rowid, search_text)
                SELECT new.rowid, new.search_text WHERE new.search_text != '';
         END;"
    ).unwrap();
    conn
}

// ── Migrated DB ──

fn migrated_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    db::migrations::run(&conn).unwrap();
    conn
}

// ── Fixture ──

fn insert_fixture(conn: &Connection) {
    let now = "2026-07-09T12:00:00Z";
    conn.execute(
        "INSERT INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            "test-note-1", "2026-07-09", "测试笔记", r#"{"ops":[{"insert":"Hello\n"}]}"#, "Hello",
            r#"["test","e2e"]"#, 1, 0, now, now,
            "projects/test", "how-to", r#"["rust","sqlite"]"#, r#"["test-note-2"]"#, 0,
        ],
    ).unwrap();

    conn.execute(
        "INSERT INTO daily_pages (date, todos, todo_carryover, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            "2026-07-09",
            r#"[{"id":"t1","text":"E2E TODO","done":false,"order":0,"tags":[]}]"#,
            1,
            now,
        ],
    )
    .unwrap();
}

fn count_notes(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap()
}

fn count_daily_pages(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM daily_pages", [], |r| r.get(0))
        .unwrap()
}

// ── Tests ──

#[test]
fn schema_columns_identical() {
    let fresh = fresh_db();
    let migrated = migrated_db();

    let fresh_cols = table_columns(&fresh);
    let migrated_cols = table_columns(&migrated);

    // 差异分析（帮助诊断）
    let only_fresh: Vec<_> = fresh_cols.difference(&migrated_cols).collect();
    let only_migrated: Vec<_> = migrated_cols.difference(&fresh_cols).collect();
    assert!(
        only_fresh.is_empty() && only_migrated.is_empty(),
        "Schema 列不一致:\n  仅 fresh 有: {:?}\n  仅 migrated 有: {:?}",
        only_fresh,
        only_migrated
    );
}

#[test]
fn schema_indexes_identical() {
    let fresh = fresh_db();
    let migrated = migrated_db();

    let fresh_idxs = table_indexes(&fresh);
    let migrated_idxs = table_indexes(&migrated);

    let only_fresh: Vec<_> = fresh_idxs.difference(&migrated_idxs).collect();
    let only_migrated: Vec<_> = migrated_idxs.difference(&fresh_idxs).collect();
    assert!(
        only_fresh.is_empty() && only_migrated.is_empty(),
        "索引不一致:\n  仅 fresh 有: {:?}\n  仅 migrated 有: {:?}",
        only_fresh,
        only_migrated
    );
}

#[test]
fn fixture_write_read_identical() {
    let fresh = fresh_db();
    let migrated = migrated_db();

    insert_fixture(&fresh);
    insert_fixture(&migrated);

    assert_eq!(count_notes(&fresh), count_notes(&migrated));
    assert_eq!(count_daily_pages(&fresh), count_daily_pages(&migrated));

    // 验证具体字段
    for conn in [&fresh, &migrated] {
        let title: String = conn
            .query_row("SELECT title FROM notes WHERE id='test-note-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(title, "测试笔记");

        let tags: String = conn
            .query_row("SELECT tags FROM notes WHERE id='test-note-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(tags.contains("test"));

        let todos: String = conn
            .query_row(
                "SELECT todos FROM daily_pages WHERE date='2026-07-09'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(todos.contains("E2E TODO"));
    }
}
