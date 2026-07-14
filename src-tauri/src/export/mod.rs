use crate::db::models::Note;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 将 Delta JSON 转换为 Markdown 文本
pub fn delta_to_markdown(content: &Value) -> String {
    let mut md = String::new();
    let mut in_code_block = false;

    if let Some(ops) = content.get("ops").and_then(|v| v.as_array()) {
        for op in ops {
            let text = op.get("insert").and_then(|v| v.as_str()).unwrap_or("");
            let attrs = op.get("attributes");

            // 代码块
            if let Some(a) = attrs {
                if a.get("code-block").and_then(|v| v.as_bool()).unwrap_or(false) {
                    if !in_code_block {
                        md.push_str("```\n");
                        in_code_block = true;
                    }
                    md.push_str(text);
                    continue;
                }
            }
            if in_code_block {
                md.push_str("```\n");
                in_code_block = false;
            }

            // 换行
            if text == "\n" {
                md.push('\n');
                continue;
            }

            // 内联格式
            let bold = attrs.and_then(|a| a.get("bold").and_then(|v| v.as_bool())).unwrap_or(false);
            let italic = attrs.and_then(|a| a.get("italic").and_then(|v| v.as_bool())).unwrap_or(false);
            let code = attrs.and_then(|a| a.get("code").and_then(|v| v.as_bool())).unwrap_or(false);

            let mut wrapped = text.to_string();
            if bold { wrapped = format!("**{}**", wrapped); }
            if italic { wrapped = format!("*{}*", wrapped); }
            if code { wrapped = format!("`{}`", wrapped); }
            md.push_str(&wrapped);
        }
    }
    if in_code_block {
        md.push_str("```\n");
    }
    md.trim().to_string()
}

/// 将 Note 导出为 .md 字符串
pub fn note_to_markdown(note: &Note) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {}\n\n", note.title.as_deref().unwrap_or("无标题")));
    md.push_str(&format!("> 日期: {} | 标签: {}\n\n", note.date, note.tags.join(", ")));
    md.push_str(&delta_to_markdown(&note.content));
    md
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
        "SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at
         FROM notes WHERE deleted_at IS NULL
         ORDER BY date, sort_order"
    )?;
    let notes: Vec<Note> = stmt.query_map([], |row| {
        crate::db::models::note_from_row(row)
    })?.filter_map(|r| r.ok()).collect();

    let mut stmt = conn.prepare(
        "SELECT date, todos, todo_carryover, updated_at FROM daily_pages ORDER BY date"
    )?;
    let daily_pages = stmt.query_map([], |row| {
        let todos_str: String = row.get(1)?;
        Ok(crate::db::models::DailyPage {
            date: row.get(0)?,
            todos: serde_json::from_str(&todos_str).unwrap_or_default(),
            todo_carryover: row.get::<_, i32>(2)? != 0,
            updated_at: row.get(3)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(ExportBundle {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        notes,
        daily_pages,
    })
}

/// 导入数据：单事务 INSERT OR REPLACE，原子性保证
pub fn import_bundle(conn: &Connection, bundle: &ExportBundle) -> rusqlite::Result<(usize, usize)> {
    let mut notes_imported = 0usize;
    let mut pages_imported = 0usize;

    conn.execute_batch("BEGIN;")?;

    for note in &bundle.notes {
        conn.execute(
            "INSERT OR REPLACE INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                note.id,
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
