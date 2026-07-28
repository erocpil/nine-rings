use rusqlite::Connection;

#[test]
fn debug_crud2() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL DEFAULT '{}',
            search_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
         );
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at)
         VALUES ('crud-1', '2026-04-01', 'test', '{}', '', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');",
    ).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // Try different UPDATE patterns
    println!("Test 1: simple string literal");
    let r1 = conn.execute("UPDATE notes SET title='updated' WHERE id='crud-1'", []);
    println!("  Result: {:?}", r1);

    println!("Test 2: execute_batch");
    let r2 = conn.execute_batch("UPDATE notes SET title='batch' WHERE id='crud-1';");
    println!("  Result: {:?}", r2);

    // Verify data still readable
    let title: String = conn
        .query_row("SELECT title FROM notes WHERE id='crud-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    println!("Final title: {}", title);
}
