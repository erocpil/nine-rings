use tauri::{
    menu::{CheckMenuItem, Menu, MenuItemKind, Submenu},
    Emitter, Manager,
};
pub const TOGGLE_HIDDEN: &str = "workbench.hidden-files";
pub struct ViewMenu {
    pub hidden: CheckMenuItem<tauri::Wry>,
}
pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app.handle())?,
    };
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
    app.set_menu(menu)?;
    app.manage(ViewMenu { hidden });
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == TOGGLE_HIDDEN {
            let _ = app.emit_to("main", "workbench:toggle-hidden", ());
        }
    });
    Ok(())
}
