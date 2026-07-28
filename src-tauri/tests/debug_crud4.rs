use rusqlite::Connection;

#[test]
fn test_empty_search_text() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('t1', '2026-01-01', 'test', '{}', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();
    nine_rings_lib::db::migrations::run(&conn).unwrap();

    println!("Update with empty search_text:");
    let r = conn.execute("UPDATE notes SET title='updated' WHERE id='t1'", []);
    println!("  {:?}", r);
}
