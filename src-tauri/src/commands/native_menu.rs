use serde::Deserialize;

#[derive(Deserialize)]
pub struct MenuState {
    id: String,
    enabled: bool,
    checked: bool,
    #[serde(default = "default_shortcut")]
    shortcut: bool,
    #[serde(default)]
    accelerator: Option<String>,
}

fn default_shortcut() -> bool {
    true
}

#[cfg(any(target_os = "macos", test))]
fn effective_accelerator<'a>(
    state: Option<&'a MenuState>,
    default: Option<&'a str>,
) -> Option<&'a str> {
    if state.is_some_and(|state| !state.shortcut) {
        return None;
    }
    state
        .and_then(|state| state.accelerator.as_deref())
        .or(default)
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{effective_accelerator, MenuState};
    use serde::Deserialize;
    use std::{collections::HashMap, sync::Mutex};
    use tauri::{
        menu::{
            CheckMenuItem, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
        },
        Manager,
    };

    #[derive(Deserialize)]
    struct Entry {
        #[serde(default)]
        text: String,
        id: Option<String>,
        accelerator: Option<String>,
        merge: Option<String>,
        before: Option<String>,
        #[serde(default)]
        separator: bool,
        #[serde(default)]
        checkable: bool,
        items: Option<Vec<Entry>>,
    }
    pub struct NativeItem {
        item: MenuItemKind<tauri::Wry>,
        accelerator: Option<String>,
        applied_accelerator: Option<String>,
    }
    pub struct NativeMenu(pub Mutex<HashMap<String, NativeItem>>);

    fn build(
        app: &tauri::App,
        entry: Entry,
        states: &mut HashMap<String, NativeItem>,
    ) -> tauri::Result<MenuItemKind<tauri::Wry>> {
        if entry.separator {
            return Ok(MenuItemKind::Predefined(PredefinedMenuItem::separator(
                app,
            )?));
        }
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
                applied_accelerator: entry.accelerator.clone(),
                accelerator: entry.accelerator,
            },
        );
        Ok(item)
    }

    fn menu_role(item: &MenuItemKind<tauri::Wry>, role: &str) -> bool {
        if role == "window" {
            return item.id().as_ref() == WINDOW_SUBMENU_ID;
        }
        matches!(item, MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|title| title.eq_ignore_ascii_case(role)))
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
        for item in original
            .iter()
            .filter(|item| menu_role(item, "file") || menu_role(item, "window"))
        {
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
        for mut entry in entries {
            if let Some(role) = entry.merge.as_deref() {
                let existing = if role == "app" {
                    original.first()
                } else {
                    original.iter().find(|item| menu_role(item, role))
                };
                if let Some(MenuItemKind::Submenu(submenu)) = existing {
                    submenu.set_text(&entry.text)?;
                    let count = submenu.items()?.len();
                    // Put Settings between About and Services. Keep the
                    // full-screen action at the end of View and Cocoa Edit first.
                    let start = match role {
                        "app" if count >= 2 => {
                            submenu.insert(&PredefinedMenuItem::separator(app)?, 2)?;
                            2
                        }
                        "view" => {
                            if count > 0 {
                                submenu.insert(&PredefinedMenuItem::separator(app)?, 0)?;
                            }
                            0
                        }
                        "edit" if count > 0 => {
                            submenu.append(&PredefinedMenuItem::separator(app)?)?;
                            count + 1
                        }
                        _ => count,
                    };
                    for (index, child) in entry
                        .items
                        .take()
                        .unwrap_or_default()
                        .into_iter()
                        .enumerate()
                    {
                        submenu.insert(&build(app, child, &mut states)?, start + index)?;
                    }
                    continue;
                }
            }
            let before = entry.before.as_deref().unwrap_or("window");
            let position = menu
                .items()?
                .iter()
                .position(|item| menu_role(item, before));
            let item = build(app, entry, &mut states)?;
            if let Some(index) = position {
                menu.insert(&item, index)?;
            } else {
                menu.append(&item)?;
            }
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
            let state = states.get(id);
            let accelerator =
                effective_accelerator(state, entry.accelerator.as_deref()).map(str::to_owned);
            if accelerator != entry.applied_accelerator {
                match &entry.item {
                    MenuItemKind::MenuItem(item) => item.set_accelerator(accelerator.as_deref()),
                    MenuItemKind::Check(item) => item.set_accelerator(accelerator.as_deref()),
                    _ => Ok(()),
                }
                .map_err(|e| e.to_string())?;
                entry.applied_accelerator = accelerator;
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
            let _ = (
                state.id,
                state.enabled,
                state.checked,
                state.shortcut,
                state.accelerator,
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_menu_old_states_keep_catalog_accelerators() {
        let old: MenuState =
            serde_json::from_str(r#"{"id":"document.save","enabled":true,"checked":false}"#)
                .unwrap();
        assert_eq!(
            effective_accelerator(Some(&old), Some("Command+S")),
            Some("Command+S")
        );
    }
    #[test]
    fn native_menu_custom_accelerators_can_change_clear_and_disable() {
        let mut state: MenuState = serde_json::from_str(
            r#"{"id":"workspace.recent","enabled":true,"checked":true,"accelerator":"Alt+1"}"#,
        )
        .unwrap();
        assert_eq!(effective_accelerator(Some(&state), None), Some("Alt+1"));
        state.accelerator = Some("CommandOrControl+1".into());
        assert_eq!(
            effective_accelerator(Some(&state), None),
            Some("CommandOrControl+1")
        );
        state.shortcut = false;
        assert_eq!(effective_accelerator(Some(&state), None), None);
        state.shortcut = true;
        state.accelerator = Some(String::new());
        assert_eq!(effective_accelerator(Some(&state), Some("Alt+1")), None);
    }
}
