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
    if attrs.and_then(|a| a.get("code")).and_then(Value::as_bool).unwrap_or(false) {
        let longest = text.split(|ch| ch != '`').map(str::len).max().unwrap_or(0);
        let fence = "`".repeat(longest + 1);
        let value = if in_table { text.replace('|', "\\|") } else { text.to_string() };
        return format!("{fence}{value}{fence}");
    }

    let mut value = escape_markdown(text, in_table);
    if attrs.and_then(|a| a.get("bold")).and_then(Value::as_bool).unwrap_or(false) {
        value = format!("**{value}**");
    }
    if attrs.and_then(|a| a.get("italic")).and_then(Value::as_bool).unwrap_or(false) {
        value = format!("*{value}*");
    }
    if attrs.and_then(|a| a.get("strike")).and_then(Value::as_bool).unwrap_or(false) {
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
        .map(|ops| ops.iter().map(|op| {
            if op.get("insert").and_then(Value::as_str) == Some("\n") {
                "<br>".to_string()
            } else {
                inline_op_to_markdown(op, true)
            }
        }).collect::<String>())
        .unwrap_or_default()
}

fn table_to_markdown(table: &Value) -> String {
    let columns = table.get("columns").and_then(Value::as_array).cloned().unwrap_or_default();
    let rows = table.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();
    let column_count = rows.iter()
        .filter_map(|row| row.get("cells").and_then(Value::as_array).map(Vec::len))
        .fold(columns.len().max(1), usize::max);
    let has_header = rows.first()
        .and_then(|row| row.get("cells"))
        .and_then(Value::as_array)
        .map(|cells| cells.iter().any(|cell| cell.get("header").and_then(Value::as_bool).unwrap_or(false)))
        .unwrap_or(false);

    let render_row = |row: Option<&Value>| -> String {
        let cells = row.and_then(|value| value.get("cells")).and_then(Value::as_array);
        let values = (0..column_count).map(|column| cell_to_markdown(cells.and_then(|items| items.get(column))))
            .collect::<Vec<_>>();
        format!("| {} |", values.join(" | "))
    };
    let mut lines = vec![render_row(if has_header { rows.first() } else { None })];
    let separators = (0..column_count).map(|column| {
        match columns.get(column).and_then(|c| c.get("align")).and_then(Value::as_str) {
            Some("center") => ":---:",
            Some("right") => "---:",
            Some("left") => ":---",
            _ => "---",
        }
    }).collect::<Vec<_>>();
    lines.push(format!("| {} |", separators.join(" | ")));
    let body_start = usize::from(has_header);
    lines.extend(rows.iter().skip(body_start).map(|row| render_row(Some(row))));
    lines.join("\n")
}

/// 将 Delta JSON（含 table embed）转换为规范化 Markdown 文本。
pub fn delta_to_markdown(content: &Value) -> String {
    let Some(ops) = content.get("ops").and_then(Value::as_array) else { return String::new(); };
    let mut blocks: Vec<(bool, String)> = Vec::new();
    let mut inline = String::new();
    let mut raw = String::new();

    let flush = |attrs: Option<&Value>, blocks: &mut Vec<(bool, String)>, inline: &mut String, raw: &mut String| {
        let attributes = attrs.unwrap_or(&Value::Null);
        let value = if attributes.get("code-block").and_then(Value::as_bool).unwrap_or(false) {
            let language = attributes.get("language").and_then(Value::as_str).unwrap_or("");
            format!("```{language}\n{}\n```", raw)
        } else if let Some(level) = attributes.get("header").and_then(Value::as_u64) {
            format!("{} {}", "#".repeat(level.clamp(1, 6) as usize), inline)
        } else if let Some(list) = attributes.get("list").and_then(Value::as_str) {
            let indent = attributes.get("indent").and_then(Value::as_u64).unwrap_or(0) as usize;
            let marker = if list == "ordered" { "1." } else { "-" };
            blocks.push((true, format!("{}{marker} {}", "  ".repeat(indent), inline)));
            inline.clear();
            raw.clear();
            return;
        } else if attributes.get("blockquote").and_then(Value::as_bool).unwrap_or(false) {
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
        if !inline.is_empty() { flush(None, &mut blocks, &mut inline, &mut raw); }
        let Some(insert) = op.get("insert") else { continue; };
        if let Some(table) = insert.get("table").filter(|table| table.get("version").and_then(Value::as_u64) == Some(1)) {
            blocks.push((false, table_to_markdown(table)));
        } else if insert.get("hr").and_then(Value::as_bool).unwrap_or(false) {
            blocks.push((false, "---".to_string()));
        } else if let Some(image) = insert.get("image").and_then(Value::as_str) {
            blocks.push((false, format!("![]({image})")));
        }
    }
    if !inline.is_empty() { flush(None, &mut blocks, &mut inline, &mut raw); }

    let mut markdown = String::new();
    for (index, (is_list, value)) in blocks.iter().enumerate() {
        if index > 0 {
            markdown.push_str(if *is_list && blocks[index - 1].0 { "\n" } else { "\n\n" });
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
pub struct ExportBundle {
    pub version: i32,
    pub exported_at: String,
    pub notes: Vec<Note>,
    pub daily_pages: Vec<crate::db::models::DailyPage>,
}

/// 导出全部数据（不含软删除的笔记）
pub fn export_all(conn: &Connection) -> rusqlite::Result<ExportBundle> {
    let mut stmt = conn.prepare(
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly
         FROM notes WHERE deleted_at IS NULL
         ORDER BY date, sort_order"
    )?;
    let notes: Vec<Note> = stmt
        .query_map([], crate::db::models::note_from_row)?
        .filter_map(|r| r.ok())
        .collect();

    let mut stmt = conn
        .prepare("SELECT date, todos, todo_carryover, updated_at FROM daily_pages ORDER BY date")?;
    let daily_pages = stmt
        .query_map([], |row| {
            let todos_str: String = row.get(1)?;
            Ok(crate::db::models::DailyPage {
                date: row.get(0)?,
                todos: serde_json::from_str(&todos_str).unwrap_or_default(),
                todo_carryover: row.get::<_, i32>(2)? != 0,
                updated_at: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ExportBundle {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        notes,
        daily_pages,
    })
}

/// 导入数据：单事务，按 id（UUID）去重
pub fn import_bundle(conn: &Connection, bundle: &ExportBundle) -> rusqlite::Result<(usize, usize)> {
    let mut notes_imported = 0usize;
    let mut pages_imported = 0usize;

    conn.execute_batch("BEGIN;")?;

    // 构建现有笔记的 id 集合（按 UUID 去重）
    let mut existing_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM notes WHERE deleted_at IS NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for id in rows.flatten() {
            existing_ids.insert(id);
        }
    }

    for note in &bundle.notes {
        // 按 id 去重（UUID 跨设备一致）
        let id = note.id.clone();

        conn.execute(
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
        conn.execute(
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

    conn.execute_batch("COMMIT;")?;

    Ok((notes_imported, pages_imported))
}

#[cfg(test)]
mod tests {
    use super::delta_to_markdown;
    use serde_json::json;

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
}
