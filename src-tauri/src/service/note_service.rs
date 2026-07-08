use crate::db;
use crate::db::models::{DailyPage, Note, NotePublic, Todo};
use rusqlite::Connection;
use serde_json::Value;

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

pub fn create_note(
    conn: &Connection,
    date: &str,
    title: Option<&str>,
    content: &Value,
    tags: &[String],
    pinned: bool,
) -> rusqlite::Result<Note> {
    let now = chrono::Utc::now().to_rfc3339();
    let search_text = extract_plain_text(content);
    // 新笔记放在同类 note 的末尾（max order + 1）
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM notes WHERE date = ?1 AND deleted_at IS NULL",
            rusqlite::params![date],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        date: date.to_string(),
        title: title.map(|s| s.to_string()),
        content: content.clone(),
        search_text,
        tags: tags.to_vec(),
        pinned,
        sort_order: max_order + 1,
        created_at: now.clone(),
        updated_at: now,
    };
    db::models::insert_note(conn, &note)?;
    Ok(note)
}

pub fn update_note(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    content: &Value,
    tags: Option<&[String]>,
    pinned: Option<bool>,
    sort_order: Option<i32>,
) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    // 查当前值，只覆盖有提供的字段
    let current = db::models::select_note_by_id(conn, id)?;
    let current = match current {
        Some(n) => n,
        None => return Ok(None),
    };

    let new_content = if content.is_null() { &current.content } else { content };
    let search_text = if content.is_null() {
        current.search_text
    } else {
        content.as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| extract_plain_text(new_content))
    };
    let new_tags = tags.unwrap_or(&current.tags);
    let new_pinned = pinned.unwrap_or(current.pinned);
    let new_order = sort_order.unwrap_or(current.sort_order);
    let new_title = title.or(current.title.as_deref());

    db::models::update_note(conn, id, new_title, new_content, &search_text, new_tags, new_pinned, new_order, &now)?;
    db::models::select_note_by_id(conn, id)
}

pub fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    db::models::soft_delete_note(conn, id, &now)
}

pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::search_notes_like(conn, query)
}

pub fn get_notes_by_tag(conn: &Connection, tag: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_tag(conn, tag)
}

pub fn get_all_tags(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    db::models::select_all_tags(conn)
}

pub fn reorder_note(conn: &Connection, id: &str, new_order: i32) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notes SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_order, now, id],
    )?;
    db::models::select_note_by_id(conn, id)
}

pub fn get_or_create_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<DailyPage> {
    if let Some(page) = db::models::select_daily_page(conn, date)? {
        return Ok(page);
    }
    let prev = db::models::select_prev_carryover_page(conn, date)?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(prev) = prev {
        if prev.todo_carryover {
            let incompleted: Vec<Todo> = prev.todos.into_iter().filter(|t| !t.done).collect();
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
        assert_eq!(extract_plain_text(&serde_json::json!({"ops": []})), "");
    }

    #[test]
    fn test_extract_plain_text_string() {
        assert_eq!(extract_plain_text(&serde_json::Value::String("plain".into())), "plain");
    }
}
