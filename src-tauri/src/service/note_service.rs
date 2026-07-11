use crate::db;
use crate::db::models::{DailyPage, Note, Todo};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
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

// ──── Note CRUD ────

pub fn get_notes_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_date(conn, date)
}

pub fn create_note(
    conn: &Connection, date: &str, title: Option<&str>, content: &Value,
    tags: &[String], pinned: bool,
) -> rusqlite::Result<Note> {
    let now = chrono::Utc::now().to_rfc3339();
    let search_text = extract_plain_text(content);
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM notes WHERE date = ?1 AND deleted_at IS NULL",
            rusqlite::params![date], |r| r.get(0),
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
        storage_path: None,
        doc_type: None,
        concepts: vec![],
        linked_doc_ids: vec![],
        readonly: false,
    };
    db::models::insert_note(conn, &note)?;
    Ok(note)
}

pub fn update_note(
    conn: &Connection, id: &str, title: Option<&str>, content: &Value,
    tags: Option<&[String]>, pinned: Option<bool>, sort_order: Option<i32>,
) -> rusqlite::Result<Option<Note>> {
    let current = match db::models::select_note_by_id(conn, id)? {
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
    let now = chrono::Utc::now().to_rfc3339();
    db::models::update_note(conn, id, new_title, new_content, &search_text, new_tags, new_pinned, new_order, &now)?;
    db::models::select_note_by_id(conn, id)
}

pub fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    db::models::soft_delete_note(conn, id, &now)
}

pub fn search_notes(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::search_notes(conn, query)
}

pub fn get_notes_by_tag(conn: &Connection, tag: &str) -> rusqlite::Result<Vec<Note>> {
    db::models::select_notes_by_tag(conn, tag)
}

pub fn get_all_tags(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    db::models::select_all_tags(conn)
}

pub fn reorder_note(conn: &Connection, id: &str, new_order: i32) -> rusqlite::Result<Option<Note>> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE notes SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_order, now, id])?;
    db::models::select_note_by_id(conn, id)
}

// ──── DailyPage ────

pub fn get_or_create_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<DailyPage> {
    if let Some(page) = db::models::select_daily_page(conn, date)? {
        return Ok(page);
    }
    let prev = db::models::select_prev_carryover_page(conn, date)?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(prev) = prev {
        if prev.todo_carryover {
            let incompleted: Vec<Todo> = prev.todos.into_iter().filter(|t| !t.done).collect();
            let page = DailyPage { date: date.to_string(), todos: incompleted, todo_carryover: true, updated_at: now };
            db::models::upsert_daily_page(conn, &page)?;
            return Ok(page);
        }
    }
    let page = DailyPage { date: date.to_string(), todos: vec![], todo_carryover: false, updated_at: now };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}

pub fn get_daily_page(conn: &Connection, date: &str) -> rusqlite::Result<Option<DailyPage>> {
    db::models::select_daily_page(conn, date)
}

pub fn update_todos(conn: &Connection, date: &str, todos: &[Todo], todo_carryover: bool) -> rusqlite::Result<DailyPage> {
    let now = chrono::Utc::now().to_rfc3339();
    let page = DailyPage { date: date.to_string(), todos: todos.to_vec(), todo_carryover, updated_at: now };
    db::models::upsert_daily_page(conn, &page)?;
    Ok(page)
}

// ──── 版本历史 ────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteVersion {
    pub id: String,
    pub note_id: String,
    pub title: Option<String>,
    pub content: serde_json::Value,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub sort_order: i32,
    pub saved_at: String,
}

fn save_version_snapshot(conn: &Connection, note: &Note) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO note_versions (id, note_id, title, content, search_text, tags, pinned, sort_order, saved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            note.id, note.title, note.content.to_string(), note.search_text,
            serde_json::to_string(&note.tags).unwrap_or_default(),
            note.pinned, note.sort_order, chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn get_note_versions(conn: &Connection, note_id: &str) -> rusqlite::Result<Vec<NoteVersion>> {
    let mut stmt = conn.prepare(
        "SELECT id, note_id, title, content, tags, pinned, sort_order, saved_at
         FROM note_versions WHERE note_id = ?1
         ORDER BY saved_at DESC LIMIT 50"
    )?;
    let rows = stmt.query_map(rusqlite::params![note_id], |row| {
        let content_str: String = row.get(3)?;
        let tags_json: String = row.get(4)?;
        Ok(NoteVersion {
            id: row.get(0)?, note_id: row.get(1)?, title: row.get(2)?,
            content: serde_json::from_str(&content_str).unwrap_or_default(),
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            pinned: row.get::<_, i32>(5)? != 0, sort_order: row.get(6)?,
            saved_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn restore_note_version(conn: &Connection, version_id: &str) -> rusqlite::Result<Option<Note>> {
    let version: NoteVersion = match conn.query_row(
        "SELECT id, note_id, title, content, tags, pinned, sort_order, '' FROM note_versions WHERE id = ?1",
        rusqlite::params![version_id],
        |row| {
            let content_str: String = row.get(3)?;
            let tags_json: String = row.get(4)?;
            Ok(NoteVersion {
                id: version_id.to_string(), note_id: row.get(1)?, title: row.get(2)?,
                content: serde_json::from_str(&content_str).unwrap_or_default(),
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                pinned: row.get::<_, i32>(5)? != 0, sort_order: row.get(6)?,
                saved_at: String::new(),
            })
        },
    ) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let now = chrono::Utc::now().to_rfc3339();
    let search_text = extract_plain_text(&version.content);
    db::models::update_note(conn, &version.note_id, version.title.as_deref(), &version.content,
        &search_text, &version.tags, version.pinned, version.sort_order, &now)?;
    db::models::select_note_by_id(conn, &version.note_id)
}

/// 更新时自动保存旧版本快照
pub fn update_note_with_version(
    conn: &Connection, id: &str, title: Option<&str>, content: &Value,
    tags: Option<&[String]>, pinned: Option<bool>, sort_order: Option<i32>,
) -> rusqlite::Result<Option<Note>> {
    if let Ok(Some(current)) = db::models::select_note_by_id(conn, id) {
        save_version_snapshot(conn, &current).ok();
    }
    update_note(conn, id, title, content, tags, pinned, sort_order)
}

// ──── Tests ────

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
