use rusqlite::Connection;

#[test]
fn test_existing_row_not_in_fts() {
    let conn = Connection::open_in_memory().unwrap();
    // Create note BEFORE migration, so it exists before triggers
    conn.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('t1', '2026-01-01', 'test', '{}', 'hello world', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();

    // Run migration - this creates FTS table and triggers
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // Check if the row is in FTS
    let fts_count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'hello'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    println!("FTS rows matching 'hello': {}", fts_count);

    // Try UPDATE - this will trigger notes_au which tries to delete old rowid from FTS
    println!("Attempting UPDATE...");
    let r = conn.execute("UPDATE notes SET title='updated' WHERE id='t1'", []);
    println!("Result: {:?}", r);

    // Try simpler: just DELETE
    if r.is_err() {
        println!("  UPDATE failed, trying DELETE instead...");
        let r2 = conn.execute("DELETE FROM notes WHERE id='t1'", []);
        println!("  DELETE Result: {:?}", r2);
    }
}
