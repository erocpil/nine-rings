/// 通用查询命令 — Op → SQL → 执行。
///
/// Phase 2：提供 db_query / db_exec / db_transaction 三个通用命令，
/// 替代旧的每个操作一个独立命令（get_notes_by_date、create_note 等）。
///
/// Phase 1 已在 TS 侧验证 5 个操作的 Op 正确性，
/// Phase 3 将逐一切换调用方到这些通用命令。
///
/// 安全模型：
/// - 仅允许 SELECT / INSERT / UPDATE 三种 Op 类型。
/// - INSERT 和 UPDATE 限制 notes / daily_pages / note_versions 三张表。
/// - SELECT 允许所有表。
/// - 所有 SQL 由 compiler 生成，不接受 RawOp。

use crate::db::query::{compile_op, Op};
use crate::AppState;
use rusqlite::params_from_iter;
use tauri::State;

#[tauri::command]
pub fn db_query(
    state: State<AppState>,
    op_json: String,
) -> Result<Vec<serde_json::Value>, String> {
    let op: Op = serde_json::from_str(&op_json).map_err(|e| format!("db_query: invalid Op JSON: {}", e))?;

    match &op {
        Op::Select(_) => {} // SELECT 允许所有表
        _ => return Err("db_query: only SELECT ops are allowed. Use db_exec for INSERT/UPDATE.".into()),
    }

    let (sql, params) = compile_op(&op).map_err(|e| format!("db_query: compile error: {}", e))?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // 纵深防御：即使 Op 类型校验被绕过，SQLite 层面也拒绝写操作
    conn.execute("PRAGMA query_only = ON", [])
        .map_err(|e| format!("db_query: failed to set query_only: {}", e))?;

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("db_query: prepare error: {}", e))?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
        .iter()
        .map(|p| p as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mut map = serde_json::Map::new();
            for (i, col_name) in row.as_ref().column_names().iter().enumerate() {
                let value: rusqlite::types::Value = row.get_unwrap(i);
                let json_val = match value {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(i) => serde_json::json!(i),
                    rusqlite::types::Value::Real(f) => serde_json::json!(f),
                    rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
                    rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
                };
                map.insert(col_name.to_string(), json_val);
            }
            Ok(serde_json::Value::Object(map))
        })
        .map_err(|e| format!("db_query: query error: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("db_query: row error: {}", e))?);
    }

    // 恢复写入权限（共享连接池，其他命令需要写入）
    let _ = conn.execute("PRAGMA query_only = OFF", []);

    Ok(results)
}

#[tauri::command]
pub fn db_exec(
    state: State<AppState>,
    op_json: String,
) -> Result<(), String> {
    let op: Op = serde_json::from_str(&op_json).map_err(|e| format!("db_exec: invalid Op JSON: {}", e))?;

    // 安全检查：仅允许 INSERT 和 UPDATE
    match &op {
        Op::Insert(ins) => {
            let allowed = ["notes", "daily_pages", "note_versions", "templates"];
            if !allowed.contains(&ins.table.as_str()) {
                return Err(format!("db_exec: table '{}' not allowed for INSERT", ins.table));
            }
        }
        Op::Update(upd) => {
            let allowed = ["notes", "daily_pages", "note_versions", "templates"];
            if !allowed.contains(&upd.table.as_str()) {
                return Err(format!("db_exec: table '{}' not allowed for UPDATE", upd.table));
            }
        }
        Op::Select(_) => return Err("db_exec: SELECT not allowed. Use db_query.".into()),
    }

    let (sql, params) = compile_op(&op).map_err(|e| format!("db_exec: compile error: {}", e))?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(&sql, params_from_iter(params.iter()))
        .map_err(|e| format!("db_exec: execute error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_transaction(
    state: State<AppState>,
    ops_json: String,
) -> Result<(), String> {
    let ops: Vec<Op> =
        serde_json::from_str(&ops_json).map_err(|e| format!("db_transaction: invalid JSON: {}", e))?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("db_transaction: BEGIN error: {}", e))?;

    for op in &ops {
        match op {
            Op::Select(_) => {
                let _ = conn.execute("ROLLBACK", []);
                return Err("db_transaction: SELECT not allowed in transaction".into());
            }
            Op::Insert(ins) => {
                let allowed = ["notes", "daily_pages", "note_versions", "templates"];
                if !allowed.contains(&ins.table.as_str()) {
                    let _ = conn.execute("ROLLBACK", []);
                    return Err(format!("db_transaction: table '{}' not allowed", ins.table));
                }
            }
            Op::Update(upd) => {
                let allowed = ["notes", "daily_pages", "note_versions", "templates"];
                if !allowed.contains(&upd.table.as_str()) {
                    let _ = conn.execute("ROLLBACK", []);
                    return Err(format!("db_transaction: table '{}' not allowed", upd.table));
                }
            }
        }

        let (sql, params) = compile_op(op)
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                format!("db_transaction: compile error: {}", e)
            })?;

        conn.execute(&sql, params_from_iter(params.iter()))
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                format!("db_transaction: execute error: {}", e)
            })?;
    }

    conn.execute("COMMIT", [])
        .map_err(|e| format!("db_transaction: COMMIT error: {}", e))?;

    Ok(())
}
