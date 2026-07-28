use rusqlite::Connection;

#[test]
fn debug_fts_rebuild() {
    let conn = Connection::open_in_memory().unwrap();

    // Create notes table manually (pre-migration state)
    conn.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('crud-1', '2026-01-01', 'test', '{}', 'hello', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();

    // Run migration
    let result = nine_rings_lib::db::migrations::run(&conn);
    println!("Migration: {:?}", result.is_ok());
    result.unwrap();

    // Check FTS index state
    let fts_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM notes_fts", [], |r| r.get(0))
        .unwrap();
    println!("FTS total rows: {}", fts_count);

    let fts_match: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'hello'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    println!("FTS matching 'hello': {}", fts_match);

    // Check if the rowid exists in FTS
    let rowid_in_fts: i32 = conn.query_row("SELECT COUNT(*) FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE id='crud-1')", [], |r| r.get(0)).unwrap();
    println!("Rowid in FTS: {}", rowid_in_fts);

    // Try the rebuild manually
    println!("Manual rebuild attempt:");
    let rebuild = conn.execute_batch(
        "INSERT INTO notes_fts(rowid, search_text) SELECT rowid, search_text FROM notes WHERE search_text != '' AND rowid NOT IN (SELECT rowid FROM notes_fts);"
    );
    println!("  Result: {:?}", rebuild);

    // Check again
    let fts_count2: i32 = conn
        .query_row("SELECT COUNT(*) FROM notes_fts", [], |r| r.get(0))
        .unwrap();
    println!("FTS total rows after rebuild: {}", fts_count2);

    // Try UPDATE now
    println!("UPDATE after rebuild:");
    let r = conn.execute("UPDATE notes SET title='updated' WHERE id='crud-1'", []);
    println!("  Result: {:?}", r);
}
