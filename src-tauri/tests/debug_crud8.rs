use rusqlite::Connection;

#[test]
fn debug_fts_values() {
    let conn = Connection::open_in_memory().unwrap();

    conn.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('crud-1', '2026-01-01', 'test', '{}', 'hello world', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // Get rowid of crud-1
    let rowid: i64 = conn
        .query_row("SELECT rowid FROM notes WHERE id='crud-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    println!("rowid: {}", rowid);

    // Delete from FTS then re-insert with VALUES
    println!("Delete from FTS then re-insert:");
    conn.execute_batch("DELETE FROM notes_fts WHERE rowid = ?1;")
        .unwrap_or(());
    // Actually can't use params with execute_batch

    // Let's try: delete the row, re-insert it, rebuild FTS
    // First: manually delete from FTS using a prepared statement
    let r = conn.execute(
        "INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', ?1, 'hello world')",
        [rowid],
    );
    println!("FTS delete result: {:?}", r);

    // Re-insert into FTS
    let r = conn.execute(
        "INSERT INTO notes_fts(rowid, search_text) VALUES (?1, 'hello world')",
        [rowid],
    );
    println!("FTS re-insert result: {:?}", r);

    // Try UPDATE
    let r = conn.execute("UPDATE notes SET title='updated' WHERE id='crud-1'", []);
    println!("UPDATE result: {:?}", r);
}
