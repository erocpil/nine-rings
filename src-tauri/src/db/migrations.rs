use rusqlite::Connection;

const _SCHEMA_VERSION: i32 = 5;

/// 执行所有迁移。
///
/// 新数据库：ensure_tables 一次性创建所有表（IF NOT EXISTS），
/// 迁移标记 v1..v5 后 ensure_indexes 创建索引。
///
/// 已有数据库：ensure_tables 补建缺失的表，增量迁移推进列变更，
/// ensure_indexes 补建缺失的索引。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);",
    )?;

    // 先确保所有表存在（幂等，IF NOT EXISTS）——即使在已标记 v1 的旧库上，
    // 也可能缺少后续版本引入的表（daily_pages, sync_changes 等）。
    ensure_tables(conn)?;

    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        migrate_v1(conn)?;
    }
    if current < 2 {
        migrate_v2(conn)?;
    }
    if current < 3 {
        migrate_v3(conn)?;
    }
    if current < 4 {
        migrate_v4(conn)?;
    }
    if current < 5 {
        migrate_v5(conn)?;
    }

    // 索引在列迁移完成后创建——若提前创建则因旧库缺少列而失败
    ensure_indexes(conn)?;
    Ok(())
}

/// 创建所有表/虚拟表（不含索引）——始终运行，幂等。
fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    for ddl in crate::db::schema_gen::SCHEMA_DDL {
        let trimmed = ddl.trim_start();
        if trimmed.starts_with("CREATE TABLE") || trimmed.starts_with("CREATE VIRTUAL TABLE") {
            conn.execute_batch(ddl)?;
        }
    }
    Ok(())
}

fn migrate_v1(conn: &Connection) -> rusqlite::Result<()> {
    // search_text 列：不在 SCHEMA_DDL 中，但 FTS 触发器需要它。
    let has_search_text: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='search_text'")?
        .query_row([], |r| r.get::<_, i32>(0))
        .unwrap_or(0)
        > 0;
    if !has_search_text {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT '';")?;
    }

    // FTS5 触发器（notes_fts 由 ensure_tables 创建）。
    // 空 search_text 会导致 FTS5 索引损坏——INSERT/SELECT 侧用 WHEN 过滤，
    // DELETE 侧始终执行（旧值可能已从旧版本索引中删除，幂等无害）。
    // DROP + CREATE 替代 IF NOT EXISTS：确保旧数据库上的损坏触发器被替换。
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
        END;
        INSERT INTO _schema_version (version) VALUES (1);",
    )?;

    // 重建 FTS 索引——旧库在迁移前已有的行不在 FTS 索引中，
    // 触发器对不存在的 rowid 执行 'delete' 会导致 FTS5 损坏（code: 267）。
    // INSERT INTO...SELECT 在 content= 表上会产生损坏条目，
    // 必须使用 Rust 逐行 VALUES 插入。
    // 先 DROP + 重建 FTS 表以清除任何损坏条目。
    conn.execute_batch("DROP TABLE IF EXISTS notes_fts;")?;
    conn.execute_batch(
        "CREATE VIRTUAL TABLE notes_fts USING fts5(search_text, content='notes', content_rowid='rowid');",
    )?;
    {
        let mut stmt =
            conn.prepare("SELECT rowid, search_text FROM notes WHERE search_text != ''")?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        for (rowid, text) in rows {
            conn.execute(
                "INSERT OR IGNORE INTO notes_fts(rowid, search_text) VALUES (?1, ?2)",
                rusqlite::params![rowid, text],
            )?;
        }
    }
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
            .prepare(&format!(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='{}'",
                col
            ))?
            .query_row([], |r| r.get::<_, i32>(0))
            .unwrap_or(0)
            > 0;
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE notes ADD COLUMN {} {};", col, def))?;
        }
    }
    conn.execute_batch("INSERT INTO _schema_version (version) VALUES (2);")?;
    Ok(())
}

fn migrate_v3(conn: &Connection) -> rusqlite::Result<()> {
    // note_versions 表由 ensure_tables 创建（IF NOT EXISTS），此处处理旧 schema 兼容。
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
            .prepare(&format!(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='{}'",
                col
            ))?
            .query_row([], |r| r.get::<_, i32>(0))
            .unwrap_or(0)
            > 0;
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE notes ADD COLUMN {} {};", col, def))?;
        }
    }
    conn.execute_batch("INSERT INTO _schema_version (version) VALUES (4);")?;
    Ok(())
}

fn migrate_v5(conn: &Connection) -> rusqlite::Result<()> {
    // templates 表由 ensure_tables 创建（IF NOT EXISTS），此处仅标记版本。
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

/// 在所有列迁移完成后创建索引。
///
/// 必须在 migrate_v1..v5 全部完成之后调用——旧库在 v1 阶段缺少 tags/storage_path 等列，
/// 提前创建索引会导致 "no such column" 错误。全新建库不受影响，
/// IF NOT EXISTS 使其幂等。
fn ensure_indexes(conn: &Connection) -> rusqlite::Result<()> {
    for ddl in crate::db::schema_gen::SCHEMA_DDL {
        let trimmed = ddl.trim_start();
        if trimmed.starts_with("CREATE INDEX") {
            conn.execute_batch(ddl)?;
        }
    }
    Ok(())
}
