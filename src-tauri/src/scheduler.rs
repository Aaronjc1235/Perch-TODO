use std::time::Duration;

use chrono::Local;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::windows;

/// How often the background task polls for due reminders.
const POLL_SECS: u64 = 30;

/// Local timestamp in the fixed-width format shared by the frontend and the
/// scheduler. Fixed width + no timezone makes lexicographic comparison valid.
pub fn now_string() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Background loop. Lives in Rust so reminders fire even when every window is
/// hidden or closed (the app stays alive in the tray).
pub async fn run(app: AppHandle, pool: SqlitePool) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_SECS));
    loop {
        interval.tick().await;
        if let Err(e) = tick(&app, &pool).await {
            // The tasks table may not exist yet on the very first tick (the
            // frontend runs migrations on load); just log and retry next tick.
            eprintln!("[scheduler] {e}");
        }
    }
}

async fn tick(app: &AppHandle, pool: &SqlitePool) -> Result<(), String> {
    let now = now_string();
    let rows = sqlx::query(
        "SELECT id, title, start_time FROM tasks \
         WHERE remind_at IS NOT NULL AND remind_at <= ?1 \
         AND reminded = 0 AND completed = 0",
    )
    .bind(&now)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("select due reminders: {e}"))?;

    if rows.is_empty() {
        return Ok(());
    }

    for row in rows {
        let id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
        let title: String = row.try_get("title").map_err(|e| e.to_string())?;
        let start_time: Option<String> = row.try_get("start_time").ok();

        let body = match start_time.as_deref() {
            Some(t) if !t.is_empty() => format!("A las {t}"),
            _ => "Recordatorio".to_string(),
        };

        let _ = app
            .notification()
            .builder()
            .title(&title)
            .body(&body)
            .show();

        let _ = windows::open_overlay(app, id);

        sqlx::query("UPDATE tasks SET reminded = 1, updated_at = ?2 WHERE id = ?1")
            .bind(id)
            .bind(&now)
            .execute(pool)
            .await
            .map_err(|e| format!("mark reminded: {e}"))?;
    }

    // Let the main panel refresh its list.
    let _ = app.emit("tasks-updated", ());
    Ok(())
}
