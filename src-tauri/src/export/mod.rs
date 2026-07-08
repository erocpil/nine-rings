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

/// 导入数据：合并到当前数据库（跳过已存在的 id）
pub fn import_bundle(conn: &Connection, bundle: &ExportBundle) -> rusqlite::Result<(usize, usize)> {
    let mut notes_imported = 0usize;
    let mut pages_imported = 0usize;

    for note in &bundle.notes {
        let exists: bool = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", rusqlite::params![note.id], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        if !exists {
            crate::db::models::insert_note(conn, note)?;
            notes_imported += 1;
        }
    }

    for page in &bundle.daily_pages {
        let exists: bool = conn
            .query_row("SELECT COUNT(*) FROM daily_pages WHERE date = ?1", rusqlite::params![page.date], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        if !exists {
            crate::db::models::upsert_daily_page(conn, page)?;
            pages_imported += 1;
        }
    }

    Ok((notes_imported, pages_imported))
}
