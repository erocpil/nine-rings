use serde::Deserialize;

#[derive(Deserialize)]
pub struct MenuState {
    id: String,
    enabled: bool,
    checked: bool,
    #[serde(default = "default_shortcut")]
    shortcut: bool,
}

fn default_shortcut() -> bool {
    true
}

#[cfg(target_os = "macos")]
mod macos {
    use super::MenuState;
    use serde::Deserialize;
    use std::{collections::HashMap, sync::Mutex};
    use tauri::{
        menu::{
            CheckMenuItem, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        },
        Manager,
    };

    #[derive(Deserialize)]
    struct Entry {
        text: String,
        id: Option<String>,
        accelerator: Option<String>,
        merge: Option<String>,
        #[serde(default)]
        checkable: bool,
        items: Option<Vec<Entry>>,
    }
    pub struct NativeItem {
        item: MenuItemKind<tauri::Wry>,
        accelerator: Option<String>,
        shortcut: bool,
    }
    pub struct NativeMenu(pub Mutex<HashMap<String, NativeItem>>);

    fn build(
        app: &tauri::App,
        entry: Entry,
        states: &mut HashMap<String, NativeItem>,
    ) -> tauri::Result<MenuItemKind<tauri::Wry>> {
        if let Some(children) = entry.items {
            let submenu = Submenu::new(app, entry.text, true)?;
            for child in children {
                submenu.append(&build(app, child, states)?)?;
            }
            return Ok(MenuItemKind::Submenu(submenu));
        }
        let id = format!("nr-menu:{}", entry.id.unwrap_or_default());
        let item = if entry.checkable {
            MenuItemKind::Check(CheckMenuItem::with_id(
                app,
                &id,
                entry.text,
                false,
                false,
                entry.accelerator.as_deref(),
            )?)
        } else {
            MenuItemKind::MenuItem(MenuItem::with_id(
                app,
                &id,
                entry.text,
                false,
                entry.accelerator.as_deref(),
            )?)
        };
        states.insert(
            id,
            NativeItem {
                item: item.clone(),
                accelerator: entry.accelerator,
                shortcut: true,
            },
        );
        Ok(item)
    }
    pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        let Some(menu) = app.menu() else {
            return Ok(());
        };
        let entries: Vec<Entry> =
            serde_json::from_str(include_str!("../../../src/lib/native-menu-catalog.json"))?;
        let mut states = HashMap::new();
        // Preserve the existing Cocoa application/Edit/Window menus and their
        // standard responders, including the save-before-quit replacement.
        let original = menu.items()?;
        // Tauri's default File and Window menus both install a Cocoa Close
        // responder with Command+W. The application now owns that shortcut for
        // closing a file, and exposes window hiding separately as Shift+Command+W.
        for item in &original {
            if let MenuItemKind::Submenu(submenu) = item {
                for child in submenu.items()? {
                    if let MenuItemKind::Predefined(predefined) = &child {
                        if matches!(
                            predefined.text()?.as_str(),
                            "Close" | "Close Window" | "C&lose Window"
                        ) {
                            submenu.remove(&child)?;
                        }
                    }
                }
            }
        }
        let help = original
            .iter()
            .find(|item| item.id().as_ref() == HELP_SUBMENU_ID);
        if let Some(help) = help {
            menu.remove(help)?;
        }
        for mut entry in entries {
            if entry.merge.as_deref() == Some("file") {
                let file = original.iter().find_map(|item| match item {
                    MenuItemKind::Submenu(submenu)
                        if submenu
                            .text()
                            .is_ok_and(|name| name == "File" || name == "文件") =>
                    {
                        Some(submenu)
                    }
                    _ => None,
                });
                if let Some(file) = file {
                    if !file.items()?.is_empty() {
                        file.insert(&PredefinedMenuItem::separator(app)?, 0)?;
                    }
                    for (index, child) in entry
                        .items
                        .take()
                        .unwrap_or_default()
                        .into_iter()
                        .enumerate()
                    {
                        file.insert(&build(app, child, &mut states)?, index)?;
                    }
                    continue;
                }
            }
            menu.append(&build(app, entry, &mut states)?)?;
        }
        if let Some(help) = help {
            menu.append(help)?;
        }
        app.manage(NativeMenu(Mutex::new(states)));
        Ok(())
    }
    pub fn update(app: &tauri::AppHandle, states: Vec<MenuState>) -> Result<(), String> {
        let Some(menu) = app.try_state::<NativeMenu>() else {
            return Ok(());
        };
        let mut items = menu.0.lock().map_err(|e| e.to_string())?;
        let states: HashMap<_, _> = states
            .into_iter()
            .map(|s| (format!("nr-menu:{}", s.id), s))
            .collect();
        for (id, entry) in items.iter_mut() {
            let shortcut = states.get(id).is_none_or(|state| state.shortcut);
            if shortcut != entry.shortcut {
                let accelerator = if shortcut {
                    entry.accelerator.as_deref()
                } else {
                    None
                };
                match &entry.item {
                    MenuItemKind::MenuItem(item) => item.set_accelerator(accelerator),
                    MenuItemKind::Check(item) => item.set_accelerator(accelerator),
                    _ => Ok(()),
                }
                .map_err(|e| e.to_string())?;
                entry.shortcut = shortcut;
            }
            let item = &entry.item;
            let state = states.get(id);
            let enabled = state.is_some_and(|s| s.enabled);
            match item {
                MenuItemKind::MenuItem(item) => item.set_enabled(enabled),
                MenuItemKind::Check(item) => {
                    item.set_checked(state.is_some_and(|s| s.checked))
                        .map_err(|e| e.to_string())?;
                    item.set_enabled(enabled)
                }
                _ => continue,
            }
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
#[cfg(target_os = "macos")]
pub use macos::install;

/// Caller must be the main view; print/plugin windows cannot control app menus.
#[tauri::command]
pub fn update_native_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    states: Vec<MenuState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主窗口更新菜单".into());
    }
    #[cfg(target_os = "macos")]
    return macos::update(&app, states);
    #[cfg(not(target_os = "macos"))]
    {
        // Keep the IPC DTO identical across builds; no native menu is
        // installed on these platforms. Consume its fields to keep strict
        // Windows/Linux dead-code checks clean.
        let _ = app;
        for state in states {
            let _ = (state.id, state.enabled, state.checked, state.shortcut);
        }
        Ok(())
    }
}
