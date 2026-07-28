use rusqlite::Connection;

const SCHEMA_VERSION: i32 = 6;

/// 执行所有迁移。
///
/// 新数据库：ensure_tables 一次性创建所有表（IF NOT EXISTS），
/// 迁移标记 v1..v6 后 ensure_indexes 创建索引。
///
/// 已有数据库：ensure_tables 补建缺失的表，增量迁移推进列变更，
/// ensure_indexes 补建缺失的索引。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    // SQLite DDL 也是事务性的。整轮迁移必须原子完成，避免表/触发器已经
    // 更新但 _schema_version 尚未（或反之）的半迁移状态。
    let tx = conn.unchecked_transaction()?;

    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);",
    )?;

    // 先确保所有表存在（幂等，IF NOT EXISTS）——即使在已标记 v1 的旧库上，
    // 也可能缺少后续版本引入的表（daily_pages, sync_changes 等）。
    ensure_tables(&tx)?;

    let current: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        migrate_v1(&tx)?;
    }
    if current < 2 {
        migrate_v2(&tx)?;
    }
    if current < 3 {
        migrate_v3(&tx)?;
    }
    if current < 4 {
        migrate_v4(&tx)?;
    }
    if current < 5 {
        migrate_v5(&tx)?;
    }
    if current < 6 {
        migrate_v6(&tx)?;
    }

    // 索引在列迁移完成后创建——若提前创建则因旧库缺少列而失败
    ensure_indexes(&tx)?;

    debug_assert_eq!(
        tx.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |r| r.get::<_, i32>(0),
        )?,
        SCHEMA_VERSION
    );
    tx.commit()
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

    install_fts_triggers(conn)?;
    rebuild_fts(conn)?;

    // 版本号必须是本迁移的最后一步；run() 外层事务保证失败时整体回滚。
    conn.execute(
        "INSERT INTO _schema_version (version) VALUES (1)",
        [],
    )?;
    Ok(())
}

/// 安装与“空 search_text 不入索引”策略匹配的 FTS 触发器。
///
/// 如果旧值为空，它从未写入 FTS，因此 DELETE/UPDATE 不能向 FTS 发送
/// delete 命令，否则 SQLite 会将索引标记为 malformed。
fn install_fts_triggers(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS notes_ai;
         DROP TRIGGER IF EXISTS notes_ad;
         DROP TRIGGER IF EXISTS notes_au;
         CREATE TRIGGER notes_ai AFTER INSERT ON notes
         WHEN new.search_text != '' BEGIN
            INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
        END;
        CREATE TRIGGER notes_ad AFTER DELETE ON notes
        WHEN old.search_text != '' BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
        END;
        CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, search_text)
                SELECT 'delete', old.rowid, old.search_text WHERE old.search_text != '';
            INSERT INTO notes_fts(rowid, search_text)
                SELECT new.rowid, new.search_text WHERE new.search_text != '';
        END;",
    )
}

/// 从 notes 的非空 search_text 原子重建全文索引。
fn rebuild_fts(conn: &Connection) -> rusqlite::Result<()> {
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

/// v6：将已经发布的 v1-v5 数据库升级到安全的 FTS 触发器。
fn migrate_v6(conn: &Connection) -> rusqlite::Result<()> {
    install_fts_triggers(conn)?;
    rebuild_fts(conn)?;
    conn.execute(
        "INSERT INTO _schema_version (version) VALUES (6)",
        [],
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
/// 必须在 migrate_v1..v6 全部完成之后调用——旧库在 v1 阶段缺少 tags/storage_path 等列，
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
