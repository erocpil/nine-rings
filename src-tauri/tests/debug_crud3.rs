use rusqlite::Connection;

#[test]
fn compare_fresh_vs_migrated() {
    // Fresh DB
    let fresh = Connection::open_in_memory().unwrap();
    nine_rings_lib::db::migrations::run(&fresh).unwrap();
    fresh.execute("INSERT INTO notes(id,date,title,content,search_text,created_at,updated_at) VALUES ('f1','2026-01-01','fresh','{}','text','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", []).unwrap();
    println!("Fresh INSERT: ok");
    let r = fresh.execute("UPDATE notes SET title='updated' WHERE id='f1'", []);
    println!("Fresh UPDATE: {:?}", r);

    // Migrated DB (table created before migrations)
    let migrated = Connection::open_in_memory().unwrap();
    migrated.execute_batch(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '{}', search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
         INSERT INTO notes(id, date, title, content, search_text, created_at, updated_at) VALUES ('m1', '2026-01-01', 'migrated', '{}', 'text', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    ).unwrap();
    nine_rings_lib::db::migrations::run(&migrated).unwrap();

    // Also try INSERT after migration
    println!("Migrated INSERT after migration:");
    let r = migrated.execute("INSERT INTO notes(id,date,title,content,search_text,created_at,updated_at) VALUES ('m2','2026-01-02','new','{}','text2','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')", []);
    println!("  {:?}", r);

    println!("Migrated UPDATE on pre-existing row:");
    let r = migrated.execute("UPDATE notes SET title='updated' WHERE id='m1'", []);
    println!("  {:?}", r);

    println!("Migrated UPDATE on new row:");
    let r = migrated.execute("UPDATE notes SET title='updated2' WHERE id='m2'", []);
    println!("  {:?}", r);

    // Delete the pre-existing row
    println!("Migrated DELETE on pre-existing row:");
    let r = migrated.execute("DELETE FROM notes WHERE id='m1'", []);
    println!("  {:?}", r);
}
