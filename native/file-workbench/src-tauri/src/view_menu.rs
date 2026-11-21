#[cfg(target_os = "macos")]
use std::collections::HashMap;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItemKind, Submenu},
    Emitter, Manager,
};

pub const NEW_FILE: &str = "workbench.new-file";
pub const CLOSE_FILE: &str = "workbench.close-file";
pub const TOGGLE_HIDDEN: &str = "workbench.hidden-files";
pub struct ViewMenu {
    pub hidden: CheckMenuItem<tauri::Wry>,
    #[cfg(target_os = "macos")]
    editor_commands: HashMap<String, MenuItemKind<tauri::Wry>>,
}

#[cfg(target_os = "macos")]
const EDITOR_PREFIX: &str = "workbench-editor-menu:";

#[derive(serde::Deserialize)]
pub struct EditorMenuState {
    id: String,
    enabled: bool,
    checked: bool,
}

#[tauri::command]
pub fn workbench_set_editor_menu(
    window: tauri::WebviewWindow,
    menu: tauri::State<'_, ViewMenu>,
    states: Vec<EditorMenuState>,
) -> Result<(), String> {
    super::editor_window::editor(&window)?;
    #[cfg(target_os = "macos")]
    {
        for (id, item) in &menu.editor_commands {
            let state = states.iter().find(|state| state.id == *id);
            let enabled = state.is_some_and(|state| state.enabled);
            match item {
                MenuItemKind::MenuItem(item) => item.set_enabled(enabled),
                MenuItemKind::Check(item) => {
                    item.set_checked(state.is_some_and(|state| state.checked))
                        .map_err(|error| error.to_string())?;
                    item.set_enabled(enabled)
                }
                _ => continue,
            }
            .map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = menu;
        for state in states {
            let _ = (state.id, state.enabled, state.checked);
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_editor_commands(
    app: &tauri::App,
    file: &Submenu<tauri::Wry>,
    edit: &Submenu<tauri::Wry>,
    view: &Submenu<tauri::Wry>,
) -> tauri::Result<HashMap<String, MenuItemKind<tauri::Wry>>> {
    use tauri::menu::{MenuItem, PredefinedMenuItem};
    let mut commands = HashMap::new();
    let mut standard =
        |id: &str, title: &str, key: Option<&str>| -> tauri::Result<MenuItem<tauri::Wry>> {
            let item = MenuItem::with_id(app, format!("{EDITOR_PREFIX}{id}"), title, false, key)?;
            commands.insert(id.to_owned(), MenuItemKind::MenuItem(item.clone()));
            Ok(item)
        };
    file.insert(&standard("document.save", "Save", Some("Command+S"))?, 1)?;
    file.append(&PredefinedMenuItem::separator(app)?)?;
    let export = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &standard("workbench.export-copy", "Source Copy…", None)?,
            &standard("document.export-html", "HTML…", None)?,
        ],
    )?;
    file.append(&export)?;
    file.append(&standard(
        "document.export-pdf",
        "Print or Save as PDF…",
        None,
    )?)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&standard("document.find", "Find…", Some("Command+F"))?)?;
    edit.append(&standard(
        "document.replace",
        "Find and Replace…",
        Some("Command+Alt+F"),
    )?)?;
    let source = CheckMenuItem::with_id(
        app,
        format!("{EDITOR_PREFIX}document.source"),
        "Source Mode",
        false,
        false,
        None::<&str>,
    )?;
    view.insert(&source, 0)?;
    commands.insert("document.source".into(), MenuItemKind::Check(source));
    Ok(commands)
}

fn about_metadata() -> tauri::menu::AboutMetadata<'static> {
    tauri::menu::AboutMetadata {
        name: Some("File Workbench".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        short_version: Some(env!("WORKBENCH_GIT_COMMIT").into()),
        ..Default::default()
    }
}
pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app.handle())?,
    };
    // Replace only the system About item; keep File/Edit/Window/Help and Quit routing.
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            for (index, child) in submenu.items()?.iter().enumerate() {
                if let MenuItemKind::Predefined(previous) = child {
                    if previous.text()?.starts_with("About ") {
                        let about = tauri::menu::PredefinedMenuItem::about(
                            app,
                            Some("About File Workbench"),
                            Some(about_metadata()),
                        )?;
                        submenu.remove_at(index)?;
                        submenu.insert(&about, index)?;
                        break;
                    }
                }
            }
        }
    }
    // Cmd/Ctrl+W closes one file, never the entire multi-file editor window.
    let close_file = tauri::menu::MenuItemBuilder::with_id(CLOSE_FILE, "Close Current File")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let new_file = tauri::menu::MenuItemBuilder::with_id(NEW_FILE, "New File")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let mut installed = false;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "File" {
                for (index, child) in submenu.items()?.iter().enumerate() {
                    if let MenuItemKind::Predefined(previous) = child {
                        if matches!(previous.text()?.as_str(), "Close" | "Close Window") {
                            submenu.remove_at(index)?;
                            break;
                        }
                    }
                }
                submenu.insert(&new_file, 0)?;
                submenu.append(&close_file)?;
                installed = true;
                break;
            }
        }
    }
    if !installed {
        menu.append(&Submenu::with_items(
            app,
            "File",
            true,
            &[&new_file, &close_file],
        )?)?;
    }
    let hidden = CheckMenuItem::with_id(
        app,
        TOGGLE_HIDDEN,
        if cfg!(target_os = "macos") {
            "Show Hidden Files in Active Panel"
        } else {
            "显示隐藏项（当前栏）"
        },
        false,
        false,
        None::<&str>,
    )?;
    let items = menu.items()?;
    let existing_submenu = |name: &str| {
        items.iter().find_map(|item| match item {
            MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|label| label == name) => {
                Some(submenu.clone())
            }
            _ => None,
        })
    };
    let view = if let Some(view) = existing_submenu("View") {
        view.insert(&tauri::menu::PredefinedMenuItem::separator(app)?, 0)?;
        view.insert(&hidden, 0)?;
        view
    } else {
        let view = Submenu::with_items(app, "View", true, &[&hidden])?;
        let position = items.iter().position(|item| matches!(item, MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|label| label == "Window" || label == "Help"))).unwrap_or(items.len());
        menu.insert(&view, position)?;
        view
    };
    #[cfg(target_os = "macos")]
    let editor_commands =
        if let (Some(file), Some(edit)) = (existing_submenu("File"), existing_submenu("Edit")) {
            install_editor_commands(app, &file, &edit, &view)?
        } else {
            HashMap::new()
        };
    #[cfg(not(target_os = "macos"))]
    let _ = view;
    #[cfg(target_os = "macos")]
    if let Some(window) = existing_submenu("Window") {
        // The focused editor owns Command+W. Keep native Minimize and Zoom.
        for item in window.items()?.into_iter().rev() {
            if matches!(&item, MenuItemKind::Predefined(predefined) if predefined.text().is_ok_and(|label| matches!(label.as_str(), "Close" | "Close Window" | "C&lose Window" | "")))
            {
                window.remove(&item)?;
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(MenuItemKind::Submenu(submenu)) = menu.items()?.first() {
        let items = submenu.items()?;
        if let Some(MenuItemKind::Predefined(quit)) = items.last() {
            let replacement =
                tauri::menu::MenuItemBuilder::with_id("workbench.confirm-quit", quit.text()?)
                    .accelerator("Command+Q")
                    .build(app)?;
            submenu.remove_at(items.len() - 1)?;
            submenu.append(&replacement)?;
        }
    }
    app.set_menu(menu)?;
    app.manage(ViewMenu {
        hidden,
        #[cfg(target_os = "macos")]
        editor_commands,
    });
    app.on_menu_event(|app, event| {
        #[cfg(target_os = "macos")]
        if let Some(id) = event.id().as_ref().strip_prefix(EDITOR_PREFIX) {
            if let Some(window) = super::editor_window::window(app)
                .filter(|window| window.is_focused().unwrap_or(false))
            {
                let _ = app.emit_to(window.label(), "workbench:editor-menu", id);
            }
            return;
        }
        if event.id().as_ref() == NEW_FILE {
            let focused = super::editor_window::window(app)
                .filter(|window| window.is_focused().unwrap_or(false));
            let target = focused
                .as_ref()
                .map(|window| window.label())
                .unwrap_or("main");
            let _ = app.emit_to(target, "workbench:new-file", ());
        }
        if event.id().as_ref() == CLOSE_FILE {
            let focused = super::editor_window::window(app)
                .filter(|window| window.is_focused().unwrap_or(false));
            let target = focused
                .as_ref()
                .map(|window| window.label())
                .unwrap_or("main");
            let _ = app.emit_to(target, "workbench:close-file", ());
        }
        if event.id().as_ref() == "workbench.confirm-quit" {
            let focused = super::editor_window::window(app)
                .filter(|window| window.is_focused().unwrap_or(false));
            let target = focused
                .as_ref()
                .map(|window| window.label())
                .unwrap_or("main");
            let _ = app.emit_to(target, "workbench:confirm-quit", ());
        }
        if event.id().as_ref() == TOGGLE_HIDDEN {
            let _ = app.emit_to("main", "workbench:toggle-hidden", ());
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn about_shows_version_and_short_commit_without_full_source_details() {
        let metadata = about_metadata();
        assert_eq!(metadata.name.as_deref(), Some("File Workbench"));
        assert_eq!(metadata.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));
        assert_eq!(
            metadata.short_version.as_deref(),
            Some(env!("WORKBENCH_GIT_COMMIT"))
        );
        assert!(metadata.credits.is_none());
        assert!(metadata.comments.is_none());
    }
}
