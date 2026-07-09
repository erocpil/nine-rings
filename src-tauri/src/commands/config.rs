use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{command, Manager, State};
use std::sync::Mutex;

/// 应用配置（与 schema/config.yaml 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub theme: String,           // "system" | "light" | "dark"
    pub default_view: String,    // "daily" | "list"
    pub todo_carryover_default: bool,
    pub auto_clean_days: i32,
    pub note_font_size: i32,
    pub enable_sync: bool,
    pub dev_port: i32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            default_view: "daily".into(),
            todo_carryover_default: false,
            auto_clean_days: 30,
            note_font_size: 16,
            enable_sync: false,
            dev_port: 1420,
        }
    }
}

/// 获取配置文件的路径
fn config_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("config.json")
}

/// 读配置文件，不存在则返回默认值
pub fn read_config(app_data_dir: &PathBuf) -> AppConfig {
    let path = config_path(app_data_dir);
    if !path.exists() {
        return AppConfig::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 写配置文件
fn write_config(app_data_dir: &PathBuf, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app_data_dir);
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ── IPC 命令 ──

#[command]
pub fn get_config(state: State<'_, Mutex<AppConfig>>) -> Result<AppConfig, String> {
    let config = state.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[command]
pub fn set_config(
    state: State<'_, Mutex<AppConfig>>,
    app_handle: tauri::AppHandle,
    config: serde_json::Value,
) -> Result<AppConfig, String> {
    let mut current = state.lock().map_err(|e| e.to_string())?;
    // 合并：只覆盖传入的字段，保留其他字段
    let current_json = serde_json::to_value(&*current).map_err(|e| e.to_string())?;
    if let serde_json::Value::Object(mut current_map) = current_json {
        if let serde_json::Value::Object(partial) = config {
            for (k, v) in partial {
                if !v.is_null() {
                    current_map.insert(k, v);
                }
            }
        }
        let merged: AppConfig =
            serde_json::from_value(serde_json::Value::Object(current_map))
                .map_err(|e| e.to_string())?;

        // 持久化
        if let Some(app_dir) = app_handle.path().app_data_dir().ok() {
            write_config(&app_dir, &merged)?;
        }

        *current = merged.clone();
        Ok(merged)
    } else {
        Err("config serialization error".into())
    }
}
