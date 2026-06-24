use std::path::PathBuf;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

/// File name of the SQLite database. The same name is used by the frontend
/// (`Database.load("sqlite:todo.db")`) and by the Rust scheduler, so both read
/// and write the exact same file. tauri-plugin-sql resolves the relative name
/// against `app_config_dir`, which we mirror in [`db_path`].
pub const DB_NAME: &str = "todo.db";
pub const DB_URL: &str = "sqlite:todo.db";

/// Absolute path of the database file, matching tauri-plugin-sql's resolution
/// (relative connection strings are placed in `app_config_dir`).
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join(DB_NAME))
}

/// A dedicated sqlx pool used by the Rust scheduler and the Rust-side commands
/// (snooze / complete / dismiss). Stored as Tauri managed state.
pub struct Db(pub SqlitePool);

pub async fn make_pool(path: &PathBuf) -> Result<SqlitePool, String> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));

    SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(opts)
        .await
        .map_err(|e| format!("connect sqlite: {e}"))
}

/// Schema migrations owned by tauri-plugin-sql. The scheduler never alters the
/// schema; it only SELECT/UPDATEs rows, so this is the single source of truth.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_tasks_and_settings",
        sql: r#"
CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  notes          TEXT    NOT NULL DEFAULT '',
  scheduled_date TEXT    NOT NULL,
  start_time     TEXT,
  end_time       TEXT,
  remind_at      TEXT,
  reminded       INTEGER NOT NULL DEFAULT 0,
  completed      INTEGER NOT NULL DEFAULT 0,
  color          TEXT    NOT NULL DEFAULT '#7aa2f7',
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"#,
        kind: MigrationKind::Up,
    }]
}
