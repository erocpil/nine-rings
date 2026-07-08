use crate::db;
use crate::db::models::{DailyPage, Note, Todo};
use rusqlite::Connection;
use serde_json::Value;

/// 从 Delta JSON 提取纯文本用于搜索
fn extract_plain_text(content: &Value) -> String {
    let mut out = String::new();
    if let Some(ops) = content.get("ops").and_then(|v| v.as_array()) {
        for op in ops {
            if let Some(insert) = op.get("insert") {
                if let Some(s) = insert.as_str() {
                    out.push_str(s);
                }
            }
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() && content.is_string() {
        return content.as_str().unwrap_or("").to_string();
    }
    trimmed.to_string()
}

pub fn get_notes_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_date(conn, date)
}

pub fn create_note(conn: &Connection, date: &str, title: Option<&str>, content: &Value) -> rusqlite::Result<Note> {
    let now = chrono::Utc::now().to_rfc3339();
    let search_text = extract_plain_text(content);
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        date: date.to_string(),
        title: title.map(|s| s.to_string()),
        content: content.clone(),
        search_text,
        created_at: now.clone(),
        updated_at: now,
    };
    db::models::insert_note(conn, &note)?;
    Ok(note)
}

pub fn update_note(conn: &Connection, id: &str, title: Option<&str>, content: &Value) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    let search_text = content.as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| extract_plain_text(content));
    db::models::update_note(conn, id, title, content, &search_text, &now)?;
    db::models::select_note_by_id(conn, id)
}

pub fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    db::models::soft_delete_note(conn, id, &now)
}

pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::search_notes_like(conn, query)
}

/// 获取指定日期的 DailyPage，不存在时自动创建。
/// 如果前一天启用了 todo_carryover，则自动继承未完成的待办。
pub fn get_or_create_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<DailyPage> {
    if let Some(page) = db::models::select_daily_page(conn, date)? {
        return Ok(page);
    }

    let prev = db::models::select_prev_carryover_page(conn, date)?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(prev) = prev {
        if prev.todo_carryover {
            let incompleted: Vec<Todo> = prev
                .todos
                .into_iter()
                .filter(|t| !t.done)
                .collect();
            let page = DailyPage {
                date: date.to_string(),
                todos: incompleted,
                todo_carryover: true,
                updated_at: now,
            };
            db::models::upsert_daily_page(conn, &page)?;
            return Ok(page);
        }
    }

    let page = DailyPage {
        date: date.to_string(),
        todos: vec![],
        todo_carryover: false,
        updated_at: now,
    };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}

pub fn get_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<Option<DailyPage>> {
    db::models::select_daily_page(conn, date)
}

pub fn update_todos(conn: &Connection, date: &str, todos: &[Todo], todo_carryover: bool) -> rusqlite::Result<DailyPage> {
    let now = chrono::Utc::now().to_rfc3339();
    let page = DailyPage {
        date: date.to_string(),
        todos: todos.to_vec(),
        todo_carryover,
        updated_at: now,
    };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_plain_text_delta() {
        let json = serde_json::json!({
            "ops": [
                {"insert": "Hello "},
                {"insert": "World", "attributes": {"bold": true}},
                {"insert": "\n"}
            ]
        });
        assert_eq!(extract_plain_text(&json), "Hello World");
    }

    #[test]
    fn test_extract_plain_text_empty() {
        let json = serde_json::json!({"ops": []});
        assert_eq!(extract_plain_text(&json), "");
    }

    #[test]
    fn test_extract_plain_text_string() {
        let json = serde_json::Value::String("plain text content".to_string());
        assert_eq!(extract_plain_text(&json), "plain text content");
    }
}
