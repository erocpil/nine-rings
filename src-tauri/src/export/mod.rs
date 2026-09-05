use crate::commands::config::AppConfig;
use crate::db::models::Note;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn escape_markdown(text: &str, in_table: bool) -> String {
    let mut escaped = String::new();
    for ch in text.chars() {
        if ch == '\\' || matches!(ch, '*' | '_' | '[' | ']') || (in_table && ch == '|') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn inline_op_to_markdown(op: &Value, in_table: bool) -> String {
    let text = op.get("insert").and_then(Value::as_str).unwrap_or("");
    let attrs = op.get("attributes");
    if attrs
        .and_then(|a| a.get("code"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let longest = text.split(|ch| ch != '`').map(str::len).max().unwrap_or(0);
        let fence = "`".repeat(longest + 1);
        let value = if in_table {
            text.replace('|', "\\|")
        } else {
            text.to_string()
        };
        return format!("{fence}{value}{fence}");
    }

    let mut value = escape_markdown(text, in_table);
    if attrs
        .and_then(|a| a.get("bold"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        value = format!("**{value}**");
    }
    if attrs
        .and_then(|a| a.get("italic"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        value = format!("*{value}*");
    }
    if attrs
        .and_then(|a| a.get("strike"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        value = format!("~~{value}~~");
    }
    if let Some(link) = attrs.and_then(|a| a.get("link")).and_then(Value::as_str) {
        value = format!("[{value}]({link})");
    }
    value
}

fn cell_to_markdown(cell: Option<&Value>) -> String {
    cell.and_then(|c| c.get("content"))
        .and_then(|c| c.get("ops"))
        .and_then(Value::as_array)
        .map(|ops| {
            ops.iter()
                .map(|op| {
                    if op.get("insert").and_then(Value::as_str) == Some("\n") {
                        "<br>".to_string()
                    } else {
                        inline_op_to_markdown(op, true)
                    }
                })
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn table_to_markdown(table: &Value) -> String {
    let columns = table
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows = table
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let column_count = rows
        .iter()
        .filter_map(|row| row.get("cells").and_then(Value::as_array).map(Vec::len))
        .fold(columns.len().max(1), usize::max);
    let has_header = rows
        .first()
        .and_then(|row| row.get("cells"))
        .and_then(Value::as_array)
        .map(|cells| {
            cells
                .iter()
                .any(|cell| cell.get("header").and_then(Value::as_bool).unwrap_or(false))
        })
        .unwrap_or(false);

    let render_row = |row: Option<&Value>| -> String {
        let cells = row
            .and_then(|value| value.get("cells"))
            .and_then(Value::as_array);
        let values = (0..column_count)
            .map(|column| cell_to_markdown(cells.and_then(|items| items.get(column))))
            .collect::<Vec<_>>();
        format!("| {} |", values.join(" | "))
    };
    let mut lines = vec![render_row(if has_header { rows.first() } else { None })];
    let separators = (0..column_count)
        .map(|column| {
            match columns
                .get(column)
                .and_then(|c| c.get("align"))
                .and_then(Value::as_str)
            {
                Some("center") => ":---:",
                Some("right") => "---:",
                Some("left") => ":---",
                _ => "---",
            }
        })
        .collect::<Vec<_>>();
    lines.push(format!("| {} |", separators.join(" | ")));
    let body_start = usize::from(has_header);
    lines.extend(
        rows.iter()
            .skip(body_start)
            .map(|row| render_row(Some(row))),
    );
    lines.join("\n")
}

/// 将 Delta JSON（含 table embed）转换为规范化 Markdown 文本。
pub fn delta_to_markdown(content: &Value) -> String {
    let Some(ops) = content.get("ops").and_then(Value::as_array) else {
        return String::new();
    };
    let mut blocks: Vec<(bool, String)> = Vec::new();
    let mut inline = String::new();
    let mut raw = String::new();

    let flush = |attrs: Option<&Value>,
                 blocks: &mut Vec<(bool, String)>,
                 inline: &mut String,
                 raw: &mut String| {
        let attributes = attrs.unwrap_or(&Value::Null);
        let value = if attributes
            .get("code-block")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let language = attributes
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("```{language}\n{}\n```", raw)
        } else if let Some(level) = attributes.get("header").and_then(Value::as_u64) {
            format!("{} {}", "#".repeat(level.clamp(1, 6) as usize), inline)
        } else if let Some(list) = attributes.get("list").and_then(Value::as_str) {
            let indent = attributes
                .get("indent")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let marker = if list == "ordered" {
                format!(
                    "{}.",
                    attributes
                        .get("listStart")
                        .and_then(Value::as_u64)
                        .unwrap_or(1)
                )
            } else {
                "-".to_string()
            };
            blocks.push((true, format!("{}{marker} {}", "  ".repeat(indent), inline)));
            inline.clear();
            raw.clear();
            return;
        } else if attributes
            .get("blockquote")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            format!("> {inline}")
        } else {
            inline.clone()
        };
        blocks.push((false, value));
        inline.clear();
        raw.clear();
    };

    for op in ops {
        if let Some(text) = op.get("insert").and_then(Value::as_str) {
            if text == "\n" {
                flush(op.get("attributes"), &mut blocks, &mut inline, &mut raw);
            } else {
                inline.push_str(&inline_op_to_markdown(op, false));
                raw.push_str(text);
            }
            continue;
        }
        if !inline.is_empty() {
            flush(None, &mut blocks, &mut inline, &mut raw);
        }
        let Some(insert) = op.get("insert") else {
            continue;
        };
        if let Some(table) = insert
            .get("table")
            .filter(|table| table.get("version").and_then(Value::as_u64) == Some(1))
        {
            blocks.push((false, table_to_markdown(table)));
        } else if insert.get("hr").and_then(Value::as_bool).unwrap_or(false) {
            blocks.push((false, "---".to_string()));
        } else if let Some(image) = insert.get("image").and_then(Value::as_str) {
            blocks.push((false, format!("![]({image})")));
        }
    }
    if !inline.is_empty() {
        flush(None, &mut blocks, &mut inline, &mut raw);
    }

    let mut markdown = String::new();
    for (index, (is_list, value)) in blocks.iter().enumerate() {
        if index > 0 {
            markdown.push_str(if *is_list && blocks[index - 1].0 {
                "\n"
            } else {
                "\n\n"
            });
        }
        markdown.push_str(value);
    }
    markdown.trim().to_string()
}

/// 将 Note 导出为 .md 字符串
pub fn note_to_markdown(note: &Note) -> String {
    let title = note.title.as_deref().unwrap_or("无标题").trim();
    let heading = format!("# {title}");
    let body = delta_to_markdown(&note.content);
    if body == heading || body.starts_with(&format!("{heading}\n")) {
        body
    } else if body.is_empty() {
        heading
    } else {
        format!("{heading}\n\n{body}")
    }
}

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
    pub daily_pages: Vec<crate::db::models::DailyPage>,
    #[serde(default)]
    pub config: Option<Value>,
    #[serde(default)]
    pub templates: Option<Vec<BackupTemplate>>,
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

    let mut stmt = conn
        .prepare("SELECT date, todos, todo_carryover, updated_at FROM daily_pages ORDER BY date")?;
    let daily_pages = stmt
        .query_map([], |row| {
            let todos_str: String = row.get(1)?;
            let todos = serde_json::from_str(&todos_str).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(crate::db::models::DailyPage {
                date: row.get(0)?,
                todos,
                todo_carryover: row.get::<_, i32>(2)? != 0,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let templates = conn.prepare("SELECT id, name, description, is_builtin, title_template, tags, storage_path, doc_type, concepts, pinned, sort_order, created_at, updated_at FROM templates")?
        .query_map([], |row| {
            let parse_list = |index| -> rusqlite::Result<Vec<String>> {
                let raw: String = row.get(index)?;
                serde_json::from_str(&raw).map_err(|error| rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error)))
            };
            Ok(BackupTemplate { id: row.get(0)?, name: row.get(1)?, description: row.get(2)?, is_builtin: row.get(3)?, title_template: row.get(4)?, tags: parse_list(5)?, storage_path: row.get(6)?, doc_type: row.get(7)?, concepts: parse_list(8)?, pinned: row.get(9)?, sort_order: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)? })
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ExportBundle {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        notes,
        daily_pages,
        config: Some(serde_json::to_value(config).unwrap_or(Value::Null)),
        templates: Some(templates),
    })
}

/// 导入数据：单事务，按 id（UUID）去重
pub fn import_bundle(
    conn: &Connection,
    bundle: &ExportBundle,
    replace: bool,
) -> rusqlite::Result<(usize, usize)> {
    let mut notes_imported = 0usize;
    let mut pages_imported = 0usize;

    let tx = conn.unchecked_transaction()?;

    if replace {
        tx.execute("DELETE FROM note_versions", [])?;
        tx.execute("DELETE FROM notes", [])?;
        tx.execute("DELETE FROM daily_pages", [])?;
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
                note.search_text,
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

    for page in &bundle.daily_pages {
        tx.execute(
            "INSERT OR REPLACE INTO daily_pages (date, todos, todo_carryover, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                page.date,
                serde_json::to_string(&page.todos).unwrap_or_default(),
                page.todo_carryover,
                page.updated_at,
            ],
        )?;
        pages_imported += 1;
    }

    if let Some(templates) = &bundle.templates {
        if replace {
            tx.execute("DELETE FROM templates", [])?;
        }
        for t in templates {
            tx.execute("INSERT OR REPLACE INTO templates (id, name, description, is_builtin, title_template, tags, storage_path, doc_type, concepts, pinned, sort_order, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", rusqlite::params![t.id, t.name, t.description, t.is_builtin, t.title_template, serde_json::to_string(&t.tags).unwrap(), t.storage_path, t.doc_type, serde_json::to_string(&t.concepts).unwrap(), t.pinned, t.sort_order, t.created_at, t.updated_at])?;
        }
    }
    tx.commit()?;

    Ok((notes_imported, pages_imported))
}

#[cfg(test)]
mod tests {
    use super::delta_to_markdown;
    use serde_json::json;

    fn backup_db() -> rusqlite::Connection {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        for ddl in crate::db::schema_gen::SCHEMA_DDL {
            db.execute_batch(ddl).unwrap();
        }
        db
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

    #[test]
    fn exports_versioned_table_embed_as_gfm() {
        let delta = json!({ "ops": [
            { "insert": { "table": {
                "version": 1,
                "columns": [{ "align": "left" }, { "align": "right" }],
                "rows": [
                    { "cells": [
                        { "header": true, "content": { "ops": [{ "insert": "Name", "attributes": { "bold": true } }] } },
                        { "header": true, "content": { "ops": [{ "insert": "Value" }] } }
                    ] },
                    { "cells": [
                        { "content": { "ops": [{ "insert": "a | b", "attributes": { "code": true } }] } },
                        { "content": { "ops": [{ "insert": "42" }] } }
                    ] }
                ]
            } } },
            { "insert": "\n" }
        ] });
        let markdown = delta_to_markdown(&delta);
        assert!(markdown.contains("| **Name** | Value |"));
        assert!(markdown.contains("| :--- | ---: |"));
        assert!(markdown.contains("`a \\| b`"));
    }

    #[test]
    fn exports_explicit_ordered_list_numbers() {
        let delta = json!({ "ops": [
            { "insert": "Second" },
            { "insert": "\n", "attributes": { "list": "ordered", "listStart": 2 } },
            { "insert": "Third" },
            { "insert": "\n", "attributes": { "list": "ordered", "listStart": 3 } }
        ] });
        assert_eq!(delta_to_markdown(&delta), "2. Second\n3. Third");
    }
}
