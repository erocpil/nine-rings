use rusqlite::Connection;

const SCHEMA_VERSION: i32 = 2;

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    // 初始化 schema 版本表
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY
        );"
    )?;

    let current: i32 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM _schema_version", [], |r| r.get(0))
        .unwrap_or(0);

    if current < 1 {
        migrate_v1(conn)?;
    }
    if current < 2 {
        migrate_v2(conn)?;
    }

    Ok(())
}

fn migrate_v1(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
            id          TEXT PRIMARY KEY,
            date        TEXT NOT NULL,
            title       TEXT,
            content     TEXT NOT NULL DEFAULT '{}',
            search_text TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            deleted_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_pages (
            date           TEXT PRIMARY KEY,
            todos          TEXT NOT NULL DEFAULT '[]',
            todo_carryover INTEGER NOT NULL DEFAULT 0,
            updated_at     TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date, created_at);
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, content,
            content='notes',
            content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.search_text);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content)
            VALUES ('delete', old.rowid, old.title, old.search_text);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content)
            VALUES ('delete', old.rowid, old.title, old.search_text);
            INSERT INTO notes_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.search_text);
        END;

        INSERT INTO _schema_version (version) VALUES (1);"
    )?;
    Ok(())
}

fn migrate_v2(conn: &Connection) -> rusqlite::Result<()> {
    // v2: 新增 tags / pinned / order 字段
    // SQLite 不支持 IF NOT EXISTS FOR ALTER TABLE，用 try-catch 模式
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('notes') WHERE name IN ('tags','pinned','order')")?
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.contains(&"tags".to_string()) {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';")?;
    }
    if !cols.contains(&"pinned".to_string()) {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !cols.contains(&"order".to_string()) {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;")?;
    }

    conn.execute_batch("INSERT INTO _schema_version (version) VALUES (2);")?;
    Ok(())
}
