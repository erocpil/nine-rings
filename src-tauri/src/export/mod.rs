use crate::commands::config::AppConfig;
use crate::db::models::Note;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 导出格式：全量笔记 + daily page
#[derive(Serialize, Deserialize)]
pub struct BackupTemplate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_builtin: bool,
    pub title_template: Option<String>,
    pub tags: Vec<String>,
    pub storage_path: Option<String>,
    pub doc_type: Option<String>,
    pub concepts: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExportBundle {
    pub version: i32,
    pub exported_at: String,
    pub notes: Vec<Note>,
    #[serde(default)]
    pub config: Option<Value>,
    #[serde(default)]
    pub templates: Option<Vec<BackupTemplate>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub protected_paths: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub protected_versions: Vec<Value>,
}

/// Check the protocol before fixed structs can silently discard an envelope.
/// No new-envelope round-trip capability is advertised by this release.
pub fn parse_legacy_bundle(json: &str) -> Result<ExportBundle, String> {
    let value: Value = serde_json::from_str(json).map_err(|_| "备份不是有效 JSON".to_string())?;
    let object = value.as_object().ok_or("备份必须为 JSON 对象")?;
    if object.contains_key("header") {
        return Err("当前版本尚不支持此同步协议；本机数据未修改".into());
    }
    drop(value);
    // Keep serde's duplicate-field checks for the fixed legacy model.
    serde_json::from_str(json).map_err(|_| "备份字段无效".to_string())
}

/// 导出全部数据（不含软删除的笔记）
pub fn export_all(conn: &Connection, config: &AppConfig) -> rusqlite::Result<ExportBundle> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes WHERE deleted_at IS NULL
         ORDER BY date, sort_order"
    )?;
    let notes: Vec<Note> = stmt
        .query_map([], crate::db::models::note_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let templates = conn.prepare("SELECT id, name, description, is_builtin, title_template, tags, storage_path, doc_type, concepts, pinned, sort_order, created_at, updated_at FROM templates")?
        .query_map([], |row| {
            let parse_list = |index| -> rusqlite::Result<Vec<String>> {
                let raw: String = row.get(index)?;
                serde_json::from_str(&raw).map_err(|error| rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error)))
            };
            Ok(BackupTemplate { id: row.get(0)?, name: row.get(1)?, description: row.get(2)?, is_builtin: row.get(3)?, title_template: row.get(4)?, tags: parse_list(5)?, storage_path: row.get(6)?, doc_type: row.get(7)?, concepts: parse_list(8)?, pinned: row.get(9)?, sort_order: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)? })
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
    let protection =
        crate::commands::protection::snapshot(conn).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let protected_versions = protection
        .versions
        .into_iter()
        .filter(|v| {
            notes.iter().any(|n| {
                Some(n.id.as_str()) == v["note_id"].as_str() && n.content.get("encrypted").is_some()
            })
        })
        .collect();
    Ok(ExportBundle {
        version: if !protection.paths.is_empty()
            || notes.iter().any(|n| n.content.get("encrypted").is_some())
        {
            2
        } else {
            1
        },
        exported_at: chrono::Utc::now().to_rfc3339(),
        notes,
        config: Some(serde_json::to_value(config).unwrap_or(Value::Null)),
        templates: Some(templates),
        protected_paths: protection.paths,
        protected_versions,
    })
}

/// 导入数据：单事务，按 id（UUID）去重
pub fn import_bundle(
    conn: &Connection,
    bundle: &ExportBundle,
    replace: bool,
) -> rusqlite::Result<usize> {
    let mut notes_imported = 0usize;

    let tx = conn.unchecked_transaction()?;

    if replace {
        tx.execute("DELETE FROM note_versions", [])?;
        tx.execute("DELETE FROM notes", [])?;
        tx.execute("DELETE FROM protected_paths", [])?;
    }

    // 构建现有笔记的 id 集合（按 UUID 去重）
    let mut existing_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let mut stmt = tx.prepare("SELECT id FROM notes WHERE deleted_at IS NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for id in rows.flatten() {
            existing_ids.insert(id);
        }
    }

    for note in &bundle.notes {
        // 按 id 去重（UUID 跨设备一致）
        let id = note.id.clone();

        tx.execute(
            "INSERT OR REPLACE INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                id,
                note.date,
                note.title,
                note.content.to_string(),
                if note.content.get("encrypted").is_some() { "" } else { &note.search_text },
                serde_json::to_string(&note.tags).unwrap_or_default(),
                note.pinned,
                note.sort_order,
                note.created_at,
                note.updated_at,
                note.storage_path,
                note.doc_type,
                serde_json::to_string(&note.concepts).unwrap_or_default(),
                serde_json::to_string(&note.linked_doc_ids).unwrap_or_default(),
                note.readonly,
            ],
        )?;
        notes_imported += 1;
    }

    if let Some(templates) = &bundle.templates {
        if replace {
            tx.execute("DELETE FROM templates", [])?;
        }
        for t in templates {
            tx.execute("INSERT OR REPLACE INTO templates (id, name, description, is_builtin, title_template, tags, storage_path, doc_type, concepts, pinned, sort_order, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", rusqlite::params![t.id, t.name, t.description, t.is_builtin, t.title_template, serde_json::to_string(&t.tags).unwrap(), t.storage_path, t.doc_type, serde_json::to_string(&t.concepts).unwrap(), t.pinned, t.sort_order, t.created_at, t.updated_at])?;
        }
    }
    for path in &bundle.protected_paths {
        let id = path["id"].as_str().ok_or(rusqlite::Error::InvalidQuery)?;
        tx.execute(
            "INSERT OR REPLACE INTO protected_paths (id,data) VALUES (?1,?2)",
            rusqlite::params![id, path.to_string()],
        )?;
    }
    for v in &bundle.protected_versions {
        if v["content"].get("encrypted").is_none() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        tx.execute("INSERT OR REPLACE INTO note_versions (id,note_id,title,content,tags,pinned,sort_order,saved_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", rusqlite::params![v["id"].as_str(),v["note_id"].as_str(),v["title"].as_str(),v["content"].to_string(),v["tags"].to_string(),v["pinned"].as_bool().unwrap_or(false),v["sort_order"].as_i64().unwrap_or(0),v["saved_at"].as_str()])?;
    }
    let protection =
        crate::commands::protection::snapshot(&tx).map_err(|_| rusqlite::Error::InvalidQuery)?;
    crate::commands::protection::validate(&protection)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    tx.commit()?;

    Ok(notes_imported)
}

#[cfg(test)]
mod tests {

    #[test]
    fn shared_protocol_gates_reject_before_storage() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../schema/sync/fixtures/legacy-gates.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let source = serde_json::to_string(&case["bundle"]).unwrap();
            assert_eq!(
                super::parse_legacy_bundle(&source).is_ok(),
                case["allowed"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
        assert!(super::parse_legacy_bundle("[1,2]").is_err());
        assert!(super::parse_legacy_bundle("PRIVATE_INVALID").is_err());
        assert!(super::parse_legacy_bundle(
            r#"{"version":1,"version":2,"exported_at":"now","notes":[]}"#
        )
        .is_err());
    }

    fn backup_db() -> rusqlite::Connection {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        for ddl in crate::db::schema_gen::SCHEMA_DDL {
            db.execute_batch(ddl).unwrap();
        }
        db
    }

    #[test]
    fn shared_storage_roundtrip_measures_retained_body_and_lost_metadata() {
        let json = include_str!("../../../schema/sync/fixtures/storage-roundtrip.json");
        let input: serde_json::Value = serde_json::from_str(json).unwrap();
        let bundle = super::parse_legacy_bundle(json).unwrap();
        let db = backup_db();
        super::import_bundle(&db, &bundle, true).unwrap();
        db.execute(
            "UPDATE notes SET title='renamed' WHERE id='roundtrip-001'",
            [],
        )
        .unwrap();
        let restored = serde_json::to_value(
            super::export_all(&db, &crate::commands::config::AppConfig::default()).unwrap(),
        )
        .unwrap();
        assert_eq!(restored["notes"][0]["title"], "renamed");
        assert_eq!(
            restored["notes"][0]["content"],
            input["notes"][0]["content"]
        );
        assert_eq!(
            restored["notes"][0]["storage_path"],
            input["notes"][0]["storage_path"]
        );
        assert_eq!(
            restored["notes"][0]["linked_doc_ids"],
            input["notes"][0]["linked_doc_ids"]
        );
        assert!(restored["notes"][0].get("futureRecord").is_none());
        assert!(restored["templates"][0].get("futureTemplate").is_none());
        assert!(restored.get("futureBundle").is_none());
    }

    #[test]
    fn candidate_app_config_survives_backup_restore_and_edit() {
        use crate::commands::config::AppConfig;
        let value: serde_json::Value = serde_json::from_str(include_str!(
            "../../../schema/sync/fixtures/app-config-v1.json"
        ))
        .unwrap();
        let config =
            crate::commands::config::merge_config(&AppConfig::default(), value.clone()).unwrap();
        let db = backup_db();
        let exported = super::export_all(&db, &config).unwrap();
        let text = serde_json::to_string(&exported).unwrap();
        let imported = super::parse_legacy_bundle(&text).unwrap();
        let current = AppConfig {
            editor_outline_fold_icon_style: Some("triangle".into()),
            ..AppConfig::default()
        };
        let restored =
            crate::commands::config::merge_config(&current, imported.config.clone().unwrap())
                .unwrap();
        let fresh = backup_db();
        super::import_bundle(&fresh, &imported, true).unwrap();
        crate::commands::config::assert_config_values(
            &super::export_all(&fresh, &restored)
                .unwrap()
                .config
                .unwrap(),
            &value,
        );
        let edited = crate::commands::config::merge_config(
            &restored,
            serde_json::json!({"navigation_tree_font_size": 21}),
        )
        .unwrap();
        let mut expected = value;
        expected["navigation_tree_font_size"] = serde_json::json!(21);
        crate::commands::config::assert_config_values(
            &super::export_all(&fresh, &edited).unwrap().config.unwrap(),
            &expected,
        );
    }

    #[test]
    fn candidate_entities_survive_sqlite_content_edit_and_fresh_restore() {
        let json = include_str!("../../../schema/sync/fixtures/candidate-entities-v1.json");
        let expected: serde_json::Value = serde_json::from_str(json).unwrap();
        let bundle = super::parse_legacy_bundle(json).unwrap();
        let db = backup_db();
        super::import_bundle(&db, &bundle, true).unwrap();
        let content = expected["notes"][0]["content"].clone();
        crate::db::models::update_note(
            &db,
            &bundle.notes[0].id,
            bundle.notes[0].title.as_deref(),
            &content,
            &bundle.notes[0].search_text,
            &bundle.notes[0].tags,
            bundle.notes[0].pinned,
            bundle.notes[0].sort_order,
            "edited",
        )
        .unwrap();
        let restored =
            super::export_all(&db, &crate::commands::config::AppConfig::default()).unwrap();
        let fresh = backup_db();
        super::import_bundle(&fresh, &restored, true).unwrap();
        let actual = serde_json::to_value(
            super::export_all(&fresh, &crate::commands::config::AppConfig::default()).unwrap(),
        )
        .unwrap();
        for input in expected["notes"].as_array().unwrap() {
            let output = actual["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == input["id"])
                .unwrap();
            for (key, value) in input.as_object().unwrap() {
                if key != "updated_at" && key != "search_text" {
                    assert_eq!(&output[key], value, "note field: {}", key);
                }
            }
            if input["id"] == "protected-001" {
                assert_eq!(output["search_text"], "");
            }
        }
        for key in ["templates", "protected_paths", "protected_versions"] {
            assert_eq!(actual[key], expected[key], "entity: {}", key);
        }
    }

    #[test]
    fn candidate_structured_text_survives_sqlite_edits_and_fresh_restore() {
        for json in [
            include_str!("../../../schema/sync/fixtures/candidate-structured-text-v1.json"),
            include_str!("../../../schema/sync/fixtures/candidate-structured-block-v1.json"),
            include_str!("../../../schema/sync/fixtures/candidate-table-v1.json"),
            include_str!("../../../schema/sync/fixtures/candidate-image-v1.json"),
            include_str!("../../../schema/sync/fixtures/candidate-inline-image-v1.json"),
            include_str!("../../../schema/sync/fixtures/candidate-reference-anchors-v1.json"),
        ] {
            let expected: serde_json::Value = serde_json::from_str(json).unwrap();
            let bundle = super::parse_legacy_bundle(json).unwrap();
            let db = backup_db();
            super::import_bundle(&db, &bundle, true).unwrap();
            for note in &bundle.notes {
                let content = expected["notes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["id"] == note.id)
                    .unwrap()["content"]
                    .clone();
                crate::db::models::update_note(
                    &db,
                    &note.id,
                    note.title.as_deref(),
                    &content,
                    &note.search_text,
                    &note.tags,
                    note.pinned,
                    note.sort_order,
                    "edited",
                )
                .unwrap();
            }
            let restored =
                super::export_all(&db, &crate::commands::config::AppConfig::default()).unwrap();
            let fresh = backup_db();
            super::import_bundle(&fresh, &restored, true).unwrap();
            let actual = serde_json::to_value(
                super::export_all(&fresh, &crate::commands::config::AppConfig::default()).unwrap(),
            )
            .unwrap();
            assert_eq!(
                actual["notes"].as_array().unwrap().len(),
                bundle.notes.len()
            );
            for input in expected["notes"].as_array().unwrap() {
                let output = actual["notes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["id"] == input["id"])
                    .unwrap();
                for (key, value) in input.as_object().unwrap() {
                    if key != "updated_at" && key != "search_text" {
                        assert_eq!(&output[key], value, "structured note field: {}", key);
                    }
                }
            }
        }
    }

    #[test]
    fn templates_round_trip_into_a_fresh_database_and_rollback_with_notes() {
        let source = backup_db();
        source.execute("INSERT INTO templates (id,name,tags,concepts,created_at,updated_at) VALUES ('custom','自定义','[\"tag\"]','[]','now','now')", []).unwrap();
        let bundle =
            super::export_all(&source, &crate::commands::config::AppConfig::default()).unwrap();
        let serialized = serde_json::to_string(&bundle).unwrap();
        let decoded: super::ExportBundle = serde_json::from_str(&serialized).unwrap();
        let destination = backup_db();
        super::import_bundle(&destination, &decoded, true).unwrap();
        assert_eq!(
            destination
                .query_row("SELECT name FROM templates WHERE id='custom'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "自定义"
        );
        destination.execute_batch("CREATE TRIGGER reject_template BEFORE INSERT ON templates BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;").unwrap();
        assert!(super::import_bundle(&destination, &decoded, true).is_err());
        assert_eq!(
            destination
                .query_row("SELECT count(*) FROM templates", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        // Legacy backups without templates must preserve local templates.
        let mut legacy: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        legacy.as_object_mut().unwrap().remove("templates");
        super::import_bundle(&destination, &serde_json::from_value(legacy).unwrap(), true).unwrap();
        assert_eq!(
            destination
                .query_row("SELECT count(*) FROM templates", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
