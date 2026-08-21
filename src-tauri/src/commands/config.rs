use crate::DataDir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{command, State};

/// 应用配置（与 schema/config.yaml 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub theme: String,        // "system" | "light" | "dark" | "fu" | ...
    pub default_view: String, // "daily" | "list"
    pub todo_carryover_default: bool,
    pub auto_clean_days: i32,
    pub note_font_size: i32,
    #[serde(default = "default_editor_font_family")]
    pub editor_font_family: String,
    #[serde(default = "default_editor_line_height")]
    pub editor_line_height: f64,
    #[serde(default = "default_editor_block_spacing")]
    pub editor_block_spacing: f64,
    #[serde(default)]
    pub editor_paragraph_indent: f64,
    #[serde(default = "default_editor_heading_margin_top")]
    pub editor_heading_margin_top: f64,
    #[serde(default = "default_editor_heading_margin_bottom")]
    pub editor_heading_margin_bottom: f64,
    #[serde(default = "default_editor_list_margin")]
    pub editor_list_margin_top: f64,
    #[serde(default = "default_editor_list_margin")]
    pub editor_list_margin_bottom: f64,
    #[serde(default = "default_editor_list_indent")]
    pub editor_list_indent: f64,
    #[serde(default = "default_editor_list_marker_gap")]
    pub editor_list_marker_gap: f64,
    #[serde(default = "default_editor_blockquote_indent")]
    pub editor_blockquote_indent: i32,
    #[serde(default = "default_editor_search_highlight_color")]
    pub editor_search_highlight_color: String,
    #[serde(default = "default_true")]
    pub editor_cjk_spacing: bool,
    pub dev_port: i32,
    #[serde(default = "default_true")]
    pub highlight_active_line: bool,
    #[serde(default)]
    pub editor_show_line_numbers: bool,
    #[serde(default = "default_true")]
    pub editor_show_status_block_number: bool,
    #[serde(default)]
    pub editor_vim_mode: bool,
    #[serde(default = "default_true")]
    pub use_custom_context_menu: bool,
    #[serde(default = "default_hotkeys")]
    pub hotkeys: std::collections::HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

fn default_editor_font_family() -> String {
    "system".into()
}

fn default_editor_line_height() -> f64 {
    1.6
}

fn default_editor_block_spacing() -> f64 {
    1.0
}

fn default_editor_heading_margin_top() -> f64 {
    0.7
}

fn default_editor_heading_margin_bottom() -> f64 {
    0.35
}

fn default_editor_list_margin() -> f64 {
    0.25
}

fn default_editor_list_indent() -> f64 {
    1.25
}

fn default_editor_list_marker_gap() -> f64 {
    0.2
}

fn default_editor_blockquote_indent() -> i32 {
    12
}

fn default_editor_search_highlight_color() -> String {
    "#ffd54f".into()
}

fn default_hotkeys() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::from([
        ("new_note".into(), "".into()),
        ("quick_capture".into(), "CommandOrControl+Alt+N".into()),
        ("focus_search".into(), "Alt+E".into()),
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
            editor_font_family: default_editor_font_family(),
            editor_line_height: default_editor_line_height(),
            editor_block_spacing: default_editor_block_spacing(),
            editor_paragraph_indent: 0.0,
            editor_heading_margin_top: default_editor_heading_margin_top(),
            editor_heading_margin_bottom: default_editor_heading_margin_bottom(),
            editor_list_margin_top: default_editor_list_margin(),
            editor_list_margin_bottom: default_editor_list_margin(),
            editor_list_indent: default_editor_list_indent(),
            editor_list_marker_gap: default_editor_list_marker_gap(),
            editor_blockquote_indent: default_editor_blockquote_indent(),
            editor_search_highlight_color: default_editor_search_highlight_color(),
            editor_cjk_spacing: true,
            dev_port: 8000,
            highlight_active_line: true,
            editor_show_line_numbers: false,
            editor_show_status_block_number: true,
            editor_vim_mode: false,
            use_custom_context_menu: true,
            hotkeys: default_hotkeys(),
        }
    }
}

/// 获取配置文件的路径
fn config_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("config.json")
}

/// 读配置文件，不存在则返回默认值
pub fn read_config(app_data_dir: &std::path::Path) -> AppConfig {
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
fn write_config(app_data_dir: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app_data_dir);
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ── IPC 命令 ──

/// 写一行到启动日志文件（跨模块复用）
fn append_startup_log(msg: &str) {
    if let Ok(dir) = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMPDIR"))
        .or_else(|_| std::env::var("TMP"))
    {
        let log_path = std::path::PathBuf::from(dir).join("nine-rings-startup.log");
        let line = format!(
            "[{}] {}\n",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            msg
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map(|mut f| {
                let _ = std::io::Write::write_all(&mut f, line.as_bytes());
            });
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
        let merged: AppConfig = serde_json::from_value(serde_json::Value::Object(current_map))
            .map_err(|e| e.to_string())?;

        // 持久化 — 用 setup() 阶段缓存的 DataDir，不依赖 IPC 上下文的 app_data_dir()
        write_config(&data_dir.0, &merged)?;

        // 验证写入结果
        let config_path = data_dir.0.join("config.json");
        let verify_ok = config_path.exists();
        let verify_size = std::fs::metadata(&config_path)
            .map(|m| m.len())
            .unwrap_or(0);
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

#[cfg(test)]
mod tests {
    use super::AppConfig;

    #[test]
    fn legacy_config_keeps_existing_values_and_gets_appearance_defaults() {
        let legacy = r#"{
            "theme":"grace",
            "default_view":"daily",
            "todo_carryover_default":false,
            "auto_clean_days":30,
            "note_font_size":19,
            "dev_port":8000,
            "highlight_active_line":true,
            "editor_show_line_numbers":false,
            "use_custom_context_menu":true,
            "hotkeys":{}
        }"#;
        let config: AppConfig = serde_json::from_str(legacy).expect("legacy config should migrate");
        assert_eq!(config.theme, "grace");
        assert_eq!(config.note_font_size, 19);
        assert_eq!(config.editor_font_family, "system");
        assert_eq!(config.editor_line_height, 1.6);
        assert_eq!(config.editor_block_spacing, 1.0);
        assert_eq!(config.editor_heading_margin_top, 0.7);
        assert_eq!(config.editor_heading_margin_bottom, 0.35);
        assert_eq!(config.editor_list_margin_top, 0.25);
        assert_eq!(config.editor_list_margin_bottom, 0.25);
        assert_eq!(config.editor_list_indent, 1.25);
        assert_eq!(config.editor_search_highlight_color, "#ffd54f");
        assert!(config.editor_cjk_spacing);
        assert!(config.editor_show_status_block_number);
    }
}
