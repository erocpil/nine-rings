/// 模板命令 — 轻量级 CRUD 操作，不纳入 Op 抽象的核心原因：
///
/// 模板表无软删除（硬 DELETE），无 IndexedDB 对等实现，
/// 操作数少（8 个内置 + 用户自定义），字段稳定。
/// 使用专用命令而非扩增 Op 类型，保持 Op 抽象的
/// "两端能力等价"边界清晰。
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn delete_template(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM templates WHERE id = ?1 AND is_builtin = 0", rusqlite::params![id])
        .map_err(|e| format!("delete_template: {e}"))?;
    Ok(())
}
