use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_positioner::{Position, WindowExt};

/// Show the main "Panel del día" window (create-on-demand is unnecessary since
/// it is declared in tauri.conf.json, but it may be hidden in the tray).
/// Showing the panel always dismisses the mini widget (they are mutually
/// exclusive states of the app).
pub fn show_main(app: &AppHandle) {
    if let Some(mini) = app.get_webview_window("mini") {
        let _ = mini.hide();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Open (or show) the small minimized widget. Once created, its size,
/// position (snap-to-edge + persisted dock in `settings`) and always-on-top
/// state are entirely owned by the frontend's pin toggle — re-showing it
/// must NOT reset either, so this only shows the existing window as-is.
pub fn open_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        let _ = win.show();
        let _ = win.emit("mini-refresh", ());
        return Ok(());
    }

    // Starts NOT pinned (not always-on-top): per spec, the minimized widget
    // should only overlay other windows once the user explicitly pins it.
    let win = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("index.html".into()))
        .title("TODO")
        .inner_size(320.0, 54.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(false)
        .resizable(false)
        .build()
        .map_err(|e| format!("build mini window: {e}"))?;

    let _ = win.move_window(Position::BottomRight);
    Ok(())
}

/// Toggle main window visibility (used by the tray left-click).
pub fn toggle_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
    }
}

/// Open (or focus) a frameless sticky-note window for a task.
pub fn open_sticky(app: &AppHandle, task_id: i64) -> Result<(), String> {
    let label = format!("sticky-{task_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Nota")
        .inner_size(260.0, 260.0)
        .min_inner_size(180.0, 160.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(true)
        .build()
        .map_err(|e| format!("build sticky window: {e}"))?;
    Ok(())
}

/// Open (or refresh) the always-on-top overlay reminder for a task. It does not
/// steal focus so it never interrupts what the user is typing.
pub fn open_overlay(app: &AppHandle, task_id: i64) -> Result<(), String> {
    let label = format!("overlay-{task_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        // Nudge the webview to re-read its state.
        let _ = win.emit("overlay-refresh", task_id);
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Recordatorio")
        .inner_size(340.0, 160.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()
        .map_err(|e| format!("build overlay window: {e}"))?;

    // Place it in the top-right corner, out of the way of the active app.
    let _ = win.move_window(Position::TopRight);
    Ok(())
}
