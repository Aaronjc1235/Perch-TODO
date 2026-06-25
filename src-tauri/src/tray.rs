use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt;

use crate::windows;

/// Build the system-tray icon, its menu and click handlers.
///
/// - Left click  → toggle the day panel (`main`).
/// - Right click → menu (quick add, view day, autostart toggle, quit).
///
/// Quitting from the menu is the only way to actually terminate the process.
pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let quick_add = MenuItemBuilder::with_id("quick_add", "Agregar tarea rápida")
        .build(app)
        .map_err(|e| e.to_string())?;
    let view_day = MenuItemBuilder::with_id("view_day", "Ver día")
        .build(app)
        .map_err(|e| e.to_string())?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "Iniciar con el sistema")
        .checked(autostart_enabled)
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", "Salir")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&quick_add)
        .item(&view_day)
        .separator()
        .item(&autostart)
        .separator()
        .item(&quit)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("icons/tray-icon-mac.png");

    #[cfg(not(target_os = "macos"))]
    let icon = app
        .default_window_icon()
        .ok_or("missing default window icon")?
        .clone();

    let tray_builder = TrayIconBuilder::with_id("main-tray").icon(icon);

    // icon_as_template is a macOS-only concept (monochrome template icons
    // rendered by the system in the appropriate menu-bar color). On Windows
    // and Linux this is a no-op, but being explicit avoids unexpected rendering.
    #[cfg(target_os = "macos")]
    let tray_builder = tray_builder.icon_as_template(true);

    tray_builder
        .tooltip("Perch TODO")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quick_add" => {
                windows::show_main(app);
                let _ = app.emit("quick-add", ());
            }
            "view_day" => windows::show_main(app),
            "autostart" => {
                let mgr = app.autolaunch();
                if mgr.is_enabled().unwrap_or(false) {
                    let _ = mgr.disable();
                } else {
                    let _ = mgr.enable();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::toggle_main(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
