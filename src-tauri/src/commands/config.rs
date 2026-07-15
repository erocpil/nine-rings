use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{command, State};
use std::sync::Mutex;
use crate::DataDir;

/// 应用配置（与 schema/config.yaml 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub theme: String,           // "system" | "light" | "dark" | "fu" | ...
    pub default_view: String,    // "daily" | "list"
    pub todo_carryover_default: bool,
    pub auto_clean_days: i32,
    pub note_font_size: i32,
    pub enable_sync: bool,
    pub dev_port: i32,
    #[serde(default = "default_true")]
    pub highlight_active_line: bool,
    #[serde(default)]
    pub editor_show_line_numbers: bool,
    #[serde(default = "default_hotkeys")]
    pub hotkeys: std::collections::HashMap<String, String>,
}

fn default_true() -> bool { true }

fn default_hotkeys() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::from([
        ("new_note".into(), "CommandOrControl+N".into()),
        ("quick_capture".into(), "CommandOrControl+Alt+N".into()),
        ("focus_search".into(), "CommandOrControl+E".into()),
        ("open_settings".into(), "Alt+,".into()),
        ("go_to_daily".into(), "CommandOrControl+Shift+D".into()),
        ("show_window".into(), "Alt+Y".into()),
    ])
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            default_view: "daily".into(),
            todo_carryover_default: false,
            auto_clean_days: 30,
            note_font_size: 16,
            enable_sync: false,
            dev_port: 1420,
            highlight_active_line: true,
            editor_show_line_numbers: false,
            hotkeys: default_hotkeys(),
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

/// 写一行到启动日志文件（跨模块复用）
fn append_startup_log(msg: &str) {
    if let Ok(dir) = std::env::var("TEMP").or_else(|_| std::env::var("TMPDIR")).or_else(|_| std::env::var("TMP")) {
        let log_path = std::path::PathBuf::from(dir).join("nine-rings-startup.log");
        let line = format!("[{}] {}\n", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
        let _ = std::fs::OpenOptions::new().create(true).append(true).open(&log_path)
            .map(|mut f| { let _ = std::io::Write::write_all(&mut f, line.as_bytes()); });
    }
}

#[command]
pub fn get_config(state: State<'_, Mutex<AppConfig>>) -> Result<AppConfig, String> {
    let config = state.lock().map_err(|e| e.to_string())?;
    let c = config.clone();
    // 诊断：如果看到这条日志，说明前端走的是 Tauri IPC（正确路径）
    append_startup_log(&format!("get_config: theme={}", c.theme));
    Ok(c)
}

#[command]
pub fn set_config(
    state: State<'_, Mutex<AppConfig>>,
    data_dir: State<'_, DataDir>,
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

        // 持久化 — 用 setup() 阶段缓存的 DataDir，不依赖 IPC 上下文的 app_data_dir()
        write_config(&data_dir.0, &merged)?;

        // 验证写入结果
        let config_path = data_dir.0.join("config.json");
        let verify_ok = config_path.exists();
        let verify_size = std::fs::metadata(&config_path).map(|m| m.len()).unwrap_or(0);
        append_startup_log(&format!(
            "set_config: wrote {:?} (exists={}, size={})",
            config_path, verify_ok, verify_size
        ));

        *current = merged.clone();
        Ok(merged)
    } else {
        Err("config serialization error".into())
    }
}
