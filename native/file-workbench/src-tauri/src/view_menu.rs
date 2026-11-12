use tauri::{
    menu::{CheckMenuItem, Menu, MenuItemKind, Submenu},
    Emitter, Manager,
};
pub const TOGGLE_HIDDEN: &str = "workbench.hidden-files";
pub struct ViewMenu {
    pub hidden: CheckMenuItem<tauri::Wry>,
}
fn about_metadata() -> tauri::menu::AboutMetadata<'static> {
    let commit = env!("WORKBENCH_GIT_COMMIT");
    let dirty = if env!("WORKBENCH_GIT_DIRTY") == "true" {
        "\n包含未提交更改"
    } else {
        ""
    };
    tauri::menu::AboutMetadata {
        name: Some("File Workbench".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        short_version: Some(commit.chars().take(8).collect()),
        credits: Some(format!("Git commit: {commit}{dirty}")),
        comments: Some(format!("Git commit: {commit}{dirty}")),
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
    let hidden = CheckMenuItem::with_id(
        app,
        TOGGLE_HIDDEN,
        "显示隐藏项（当前栏）",
        false,
        false,
        None::<&str>,
    )?;
    let view = Submenu::with_items(app, "View", true, &[&hidden])?;
    let items = menu.items()?;
    let position = items.iter().position(|item| matches!(item, MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|label| label == "Window" || label == "Help"))).unwrap_or(items.len());
    menu.insert(&view, position)?;
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
    app.manage(ViewMenu { hidden });
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "workbench.confirm-quit" {
            let _ = app.emit_to("main", "workbench:confirm-quit", ());
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
    fn about_contains_full_source_revision_and_short_visible_build_id() {
        let metadata = about_metadata();
        assert_eq!(metadata.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));
        assert!(metadata
            .credits
            .unwrap()
            .contains(env!("WORKBENCH_GIT_COMMIT")));
        assert_eq!(
            metadata.short_version.unwrap(),
            env!("WORKBENCH_GIT_COMMIT")
                .chars()
                .take(8)
                .collect::<String>()
        );
    }
}
