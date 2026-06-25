use chrono::{Duration, Local};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Db;
use crate::scheduler::now_string;
use crate::windows;

/// Open (or focus) a sticky-note window for a task.
///
/// MUST be `async`: on Windows, creating/manipulating a window inside a
/// synchronous command deadlocks the main event loop (tauri issue #4121).
/// Async commands run off the blocking path, so window creation is dispatched
/// to the main thread correctly.
#[tauri::command]
pub async fn open_sticky_note(app: AppHandle, id: i64) -> Result<(), String> {
    windows::open_sticky(&app, id)
}

/// Collapse the app into the bottom-right floating widget (hides the panel).
/// `async` for the same Windows window-creation reason as above.
#[tauri::command]
pub async fn minimize_to_widget(app: AppHandle) -> Result<(), String> {
    windows::open_mini(&app)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

/// Restore the full day panel from the widget.
/// `async` for the same Windows window-creation reason as above.
#[tauri::command]
pub async fn restore_main(app: AppHandle) {
    windows::show_main(&app);
}

/// Reschedule a reminder N minutes into the future and re-arm it.
#[tauri::command]
pub async fn snooze_task(
    app: AppHandle,
    db: State<'_, Db>,
    id: i64,
    minutes: i64,
) -> Result<(), String> {
    let new_remind = (Local::now() + Duration::minutes(minutes))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    sqlx::query("UPDATE tasks SET remind_at = ?2, reminded = 0, updated_at = ?3 WHERE id = ?1")
        .bind(id)
        .bind(&new_remind)
        .bind(now_string())
        .execute(&db.0)
        .await
        .map_err(|e| e.to_string())?;

    close_overlay(&app, id);
    let _ = app.emit("tasks-updated", ());
    Ok(())
}

/// Mark a task done from the overlay reminder.
#[tauri::command]
pub async fn complete_task(app: AppHandle, db: State<'_, Db>, id: i64) -> Result<(), String> {
    sqlx::query("UPDATE tasks SET completed = 1, updated_at = ?2 WHERE id = ?1")
        .bind(id)
        .bind(now_string())
        .execute(&db.0)
        .await
        .map_err(|e| e.to_string())?;

    close_overlay(&app, id);
    let _ = app.emit("tasks-updated", ());
    Ok(())
}

/// Just close the overlay without changing the task.
/// `async` for the same Windows window-operation reason as above.
#[tauri::command]
pub async fn dismiss_overlay(app: AppHandle, id: i64) {
    close_overlay(&app, id);
}

// --- async window-operation wrappers ---------------------------------------
// On Windows, window operations (hide/close/set_always_on_top) invoked directly
// from the frontend via the JS window API can deadlock the main event loop
// (tauri issue #4121 / #3990). Routing them through `async` commands runs them
// off the blocking path so the op is dispatched to the main thread correctly.
// The frontend calls these instead of getCurrentWindow().hide()/.close()/etc.

/// Hide the window with the given label.
#[tauri::command]
pub async fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close the window with the given label.
#[tauri::command]
pub async fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Set always-on-top for the window with the given label.
#[tauri::command]
pub async fn set_always_on_top(app: AppHandle, label: String, value: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(value).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn close_overlay(app: &AppHandle, id: i64) {
    if let Some(win) = app.get_webview_window(&format!("overlay-{id}")) {
        let _ = win.close();
    }
}
