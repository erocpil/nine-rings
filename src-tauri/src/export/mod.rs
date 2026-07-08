use crate::db::models::Note;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

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
