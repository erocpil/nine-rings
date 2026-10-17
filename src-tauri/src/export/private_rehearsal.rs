//! Opt-in disk SQLite test. Never opens an application data directory.
use super::{export_all, import_bundle, parse_legacy_bundle};
use crate::commands::config::{merge_config, AppConfig};
use rusqlite::Connection;
use serde_json::Value;
use std::{fs, path::PathBuf, time::Instant};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn sorted(mut values: Vec<Value>) -> Vec<Value> {
    values.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    values
}
#[test]
#[ignore = "requires explicit NR_SYNC_DRY_RUN_INPUT; private backup is never embedded"]
fn private_backup_disk_reopen_and_atomic_rollback() {
    let started = Instant::now();
    let input = PathBuf::from(std::env::var_os("NR_SYNC_DRY_RUN_INPUT").expect("set input path"));
    let metadata = fs::metadata(&input).expect("input unavailable");
    assert!(metadata.is_file() && metadata.len() <= 64 * 1024 * 1024);
    let source = fs::read_to_string(&input).expect("input unreadable");
    assert!(source.len() <= 64 * 1024 * 1024);
    let bundle = parse_legacy_bundle(&source).expect("unsupported private fixture");
    let config = merge_config(
        &AppConfig::default(),
        bundle.config.clone().unwrap_or(Value::Null),
    )
    .expect("config unsupported");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".local-tools");
    fs::create_dir_all(&root).unwrap();
    let scratch = Scratch(root.join(format!("sync-sqlite-{}", uuid::Uuid::new_v4())));
    fs::create_dir(&scratch.0).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&scratch.0, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let path = scratch.0.join("isolated.db");
    let db = Connection::open(&path).unwrap();
    db.pragma_update(None, "journal_mode", "WAL").unwrap();
    crate::db::migrations::run(&db).unwrap();
    crate::db::setup_fts(&db).unwrap();
    assert_eq!(
        import_bundle(&db, &bundle, true).unwrap(),
        bundle.notes.len()
    );
    drop(db);
    let db = Connection::open(&path).unwrap();
    let restored = export_all(&db, &config).unwrap();
    let actual = serde_json::to_value(&restored).unwrap();
    let mut expected = serde_json::to_value(&bundle).unwrap();
    for note in expected["notes"].as_array_mut().unwrap() {
        if note["content"].get("encrypted").is_some() {
            note["search_text"] = Value::String(String::new());
        }
    }
    for field in [
        "notes",
        "templates",
        "protected_paths",
        "protected_versions",
    ] {
        let before = expected[field].as_array().cloned().unwrap_or_default();
        let after = actual[field].as_array().cloned().unwrap_or_default();
        assert!(
            sorted(before) == sorted(after),
            "SQLite round-trip changed a record category"
        );
    }
    let mut bad = serde_json::to_value(&bundle).unwrap();
    bad["protected_versions"] =
        serde_json::json!([{"id":"invalid-protected-version", "content":{"ops":[]}}]);
    if let Some(first) = bad["notes"]
        .as_array_mut()
        .and_then(|rows| rows.first_mut())
    {
        first["title"] = Value::String("rollback sentinel".into());
    }
    let bad_bundle = parse_legacy_bundle(&bad.to_string()).unwrap();
    assert!(import_bundle(&db, &bad_bundle, true).is_err());
    let after = serde_json::to_value(export_all(&db, &config).unwrap()).unwrap();
    for field in [
        "notes",
        "templates",
        "protected_paths",
        "protected_versions",
    ] {
        assert!(
            after[field] == actual[field],
            "failed restore did not roll back"
        );
    }
    println!("{{\"runtime\":\"native-sqlite\",\"documents\":{},\"templates\":{},\"reopened\":true,\"rollback\":true,\"totalMs\":{}}}", bundle.notes.len(), bundle.templates.as_ref().map_or(0, Vec::len), started.elapsed().as_millis());
}
