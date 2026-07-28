use rusqlite::Connection;

const _SCHEMA_VERSION: i32 = 5;

/// 执行所有迁移。
///
/// 新数据库：SCHEMA_DDL 一次性创建所有表（IF NOT EXISTS），
/// 后续迁移（v2-v5）在列/表已存在时自动跳过。
///
/// 已有数据库：SCHEMA_DDL 的 IF NOT EXISTS 确保不破坏现有数据，
/// 增量迁移继续从当前版本推进到最新。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);",
    )?;

    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 { migrate_v1(conn)?; }
    if current < 2 { migrate_v2(conn)?; }
    if current < 3 { migrate_v3(conn)?; }
    if current < 4 { migrate_v4(conn)?; }
    if current < 5 { migrate_v5(conn)?; }
    Ok(())
}

fn migrate_v1(conn: &Connection) -> rusqlite::Result<()> {
    // 初始 schema：从 schema/note.yaml 生成的 SCHEMA_DDL 驱动。
    // IF NOT EXISTS 确保在增量迁移场景下不破坏已有数据。
    for ddl in crate::db::schema_gen::SCHEMA_DDL {
        conn.execute_batch(ddl)?;
    }

    // search_text 列：标记为 system，不在 SCHEMA_DDL 中，但 FTS 触发器需要它。
    // 在 SCHEMA_DDL 创建 notes 表之后添加（旧数据库可能已有，IF NOT EXISTS 风格检查）
    let has_search_text: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='search_text'")?
        .query_row([], |r| r.get::<_, i32>(0))
        .unwrap_or(0) > 0;
    if !has_search_text {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT '';")?;
    }

    // FTS5 触发器（SCHEMA_DDL 创建 notes_fts(search_text) 单列 FTS 表，
    // 触发器同步 search_text 列——纯文本提取内容，用于全文搜索）
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
            INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
        END;
        INSERT INTO _schema_version (version) VALUES (1);",
    )?;
    Ok(())
}

fn migrate_v2(conn: &Connection) -> rusqlite::Result<()> {
    // tags, pinned, sort_order — 新数据库 (SCHEMA_DDL) 自动跳过
    for &(col, def) in &[
        ("tags", "TEXT NOT NULL DEFAULT '[]'"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("sort_order", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        let exists: bool = conn
            .prepare(&format!("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='{}'", col))?
            .query_row([], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE notes ADD COLUMN {} {};", col, def))?;
        }
    }
    conn.execute_batch("INSERT INTO _schema_version (version) VALUES (2);")?;
    Ok(())
}

fn migrate_v3(conn: &Connection) -> rusqlite::Result<()> {
    // note_versions — 新数据库已在 SCHEMA_DDL 中创建（IF NOT EXISTS 跳过）。
    // 此处保留手写 DDL 兼容旧 schema（含 search_text，新 SCHEMA_DDL 不含）。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS note_versions (
            id            TEXT PRIMARY KEY,
            note_id       TEXT NOT NULL,
            title         TEXT,
            content       TEXT NOT NULL DEFAULT '{}',
            search_text   TEXT NOT NULL DEFAULT '',
            tags          TEXT NOT NULL DEFAULT '[]',
            pinned        INTEGER NOT NULL DEFAULT 0,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            saved_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id, saved_at);
        INSERT INTO _schema_version (version) VALUES (3);",
    )?;
    Ok(())
}

fn migrate_v4(conn: &Connection) -> rusqlite::Result<()> {
    // Doc Tree / Zettelkasten 字段 — 新数据库 (SCHEMA_DDL) 自动跳过
    for &(col, def) in &[
        ("storage_path", "TEXT"),
        ("doc_type", "TEXT"),
        ("concepts", "TEXT NOT NULL DEFAULT '[]'"),
        ("linked_doc_ids", "TEXT NOT NULL DEFAULT '[]'"),
        ("readonly", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        let exists: bool = conn
            .prepare(&format!("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='{}'", col))?
            .query_row([], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE notes ADD COLUMN {} {};", col, def))?;
        }
    }
    conn.execute_batch("INSERT INTO _schema_version (version) VALUES (4);")?;
    Ok(())
}

fn migrate_v5(conn: &Connection) -> rusqlite::Result<()> {
    // templates — 新数据库已在 SCHEMA_DDL 中创建（IF NOT EXISTS 跳过）
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS templates (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            description     TEXT DEFAULT '',
            is_builtin      INTEGER NOT NULL DEFAULT 0,
            title_template  TEXT,
            tags            TEXT NOT NULL DEFAULT '[]',
            storage_path    TEXT,
            doc_type        TEXT,
            concepts        TEXT DEFAULT '[]',
            pinned          INTEGER NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        INSERT INTO _schema_version (version) VALUES (5);",
    )?;
    Ok(())
}
