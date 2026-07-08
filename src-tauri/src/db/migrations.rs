use rusqlite::Connection;

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
            id          TEXT PRIMARY KEY,
            date        TEXT NOT NULL,
            title       TEXT,
            content     TEXT NOT NULL DEFAULT '{}',
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
        CREATE INDEX IF NOT EXISTS idx_notes_fts ON notes(id) WHERE deleted_at IS NULL;
        
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, content,
            content='notes',
            content_rowid='rowid'
        );

        -- FTS 同步触发器
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content)
            VALUES ('delete', old.rowid, old.title, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content)
            VALUES ('delete', old.rowid, old.title, old.content);
            INSERT INTO notes_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.content);
        END;"
    )?;
    Ok(())
}
