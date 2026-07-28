use rusqlite::Connection;

#[test]
fn debug_fts_new_row() {
    let conn = Connection::open_in_memory().unwrap();

    conn.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('crud-1', '2026-01-01', 'test', '{}', 'hello', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();

    nine_rings_lib::db::migrations::run(&conn).unwrap();

    // Insert a NEW row after migration (triggers should work on it)
    println!("INSERT new row after migration:");
    let r = conn.execute("INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('crud-2', '2026-01-02', 'new', '{}', 'world', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')", []);
    println!("  {:?}", r);

    // UPDATE the new row
    println!("UPDATE new row:");
    let r = conn.execute("UPDATE notes SET title='updated-new' WHERE id='crud-2'", []);
    println!("  {:?}", r);

    // DELETE the new row
    println!("DELETE new row:");
    let r = conn.execute("DELETE FROM notes WHERE id='crud-2'", []);
    println!("  {:?}", r);

    // Now try the old row - should it work after we no longer have the "corrupting" row?
    println!("UPDATE old row:");
    let r = conn.execute("UPDATE notes SET title='updated-old' WHERE id='crud-1'", []);
    println!("  {:?}", r);
}
