use rusqlite::Connection;

#[test]
fn debug_crud() {
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
    println!("Before migration: ok");
    let result = nine_rings_lib::db::migrations::run(&conn);
    println!("Migration result: {:?}", result.is_ok());
    result.unwrap();

    // Check schema version
    let v: i32 = conn
        .query_row("SELECT MAX(version) FROM _schema_version", [], |r| r.get(0))
        .unwrap();
    println!("Version: {}", v);

    // Check columns
    let mut stmt = conn
        .prepare("SELECT name FROM pragma_table_info('notes') ORDER BY cid")
        .unwrap();
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("Columns: {:?}", cols);

    // Try simple query first
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    println!("Count: {}", count);

    // Try UPDATE
    println!("Attempting UPDATE...");
    conn.execute("UPDATE notes SET title='updated' WHERE id='crud-1'", [])
        .unwrap();
    println!("UPDATE succeeded");
}
