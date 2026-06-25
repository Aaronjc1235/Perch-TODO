mod commands;
mod db;
mod scheduler;
mod tray;
mod windows;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // single-instance must be the FIRST plugin registered. Focus the existing
    // window instead of spawning a duplicate process.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        windows::show_main(app);
    }));

    builder
        .plugin(
            // Save size + position but NOT visibility — startup logic in
            // setup() is the single authority on which windows are shown.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_sticky_note,
            commands::minimize_to_widget,
            commands::restore_main,
            commands::snooze_task,
            commands::complete_task,
            commands::dismiss_overlay,
            commands::hide_window,
            commands::close_window,
            commands::set_always_on_top,
        ])
        .on_window_event(|window, event| {
            // The app never quits when a window is closed: hide it and keep
            // living in the tray. Only "Salir" from the tray terminates.
            // Overlay reminders are transient and may close for real.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" || label.starts_with("sticky-") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Dedicated sqlx pool for the Rust scheduler + Rust-side commands,
            // pointing at the very same file tauri-plugin-sql uses.
            let path = db::db_path(&handle)?;
            let pool = tauri::async_runtime::block_on(db::make_pool(&path))?;
            app.manage(db::Db(pool.clone()));

            tray::setup_tray(&handle)?;

            // Enable autostart on first launch (idempotent — safe to call every run).
            use tauri_plugin_autostart::ManagerExt;
            let _ = app.autolaunch().enable();

            // Reminder loop in the background (survives all windows being hidden).
            tauri::async_runtime::spawn(scheduler::run(handle.clone(), pool));

            // Defer window show so it runs after window-state plugin has
            // finished restoring any persisted size/position, ensuring our
            // visibility decision is always the last word.
            let h = handle.clone();
            let minimized = std::env::args().any(|a| a == "--minimized");
            tauri::async_runtime::spawn(async move {
                if minimized {
                    let _ = windows::open_mini(&h);
                } else {
                    windows::show_main(&h);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
