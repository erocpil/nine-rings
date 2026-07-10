use rusqlite::Connection;
use rusqlite::params;

const SCHEMA_VERSION: i32 = 4;

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);")?;

    let current: i32 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM _schema_version", [], |r| r.get(0))
        .unwrap_or(0);

    if current < 1 { migrate_v1(conn)?; }
    if current < 2 { migrate_v2(conn)?; }
    if current < 3 { migrate_v3(conn)?; }
    if current < 4 { migrate_v4(conn)?; }
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
            title, content, content='notes', content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.search_text);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.search_text);
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.search_text);
        END;
        INSERT INTO _schema_version (version) VALUES (1);"
    )?;
    Ok(())
}

fn migrate_v2(conn: &Connection) -> rusqlite::Result<()> {
    // 检查列是否存在
    for &(col, def) in &[("tags", "TEXT NOT NULL DEFAULT '[]'"), ("pinned", "INTEGER NOT NULL DEFAULT 0"), ("sort_order", "INTEGER NOT NULL DEFAULT 0")] {
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
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS note_versions (
            id          TEXT PRIMARY KEY,
            note_id     TEXT NOT NULL,
            title       TEXT,
            content     TEXT NOT NULL DEFAULT '{}',
            search_text TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '[]',
            pinned      INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            saved_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id, saved_at);
        INSERT INTO _schema_version (version) VALUES (3);"
    )?;
    Ok(())
}

fn migrate_v4(conn: &Connection) -> rusqlite::Result<()> {
    // Doc Tree / Zettelkasten 字段
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
