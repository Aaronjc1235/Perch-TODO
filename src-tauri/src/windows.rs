use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_positioner::{Position, WindowExt};

/// Show the main "Panel del día" window (create-on-demand is unnecessary since
/// it is declared in tauri.conf.json, but it may be hidden in the tray).
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
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
