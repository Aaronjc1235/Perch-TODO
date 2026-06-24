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
    }, Migration {
        version: 2,
        description: "index_tasks_for_scale",
        sql: r#"
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_date ON tasks(scheduled_date);

-- Partial index matching the scheduler's poll query exactly (remind_at IS
-- NOT NULL AND reminded = 0 AND completed = 0): only pending reminders ever
-- enter it, so it stays tiny regardless of how many tasks accumulate.
CREATE INDEX IF NOT EXISTS idx_tasks_pending_reminders
  ON tasks(remind_at)
  WHERE remind_at IS NOT NULL AND reminded = 0 AND completed = 0;
"#,
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Row, SqlitePool};

    const CREATE: &str = "CREATE TABLE tasks (\
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', \
        scheduled_date TEXT NOT NULL, start_time TEXT, end_time TEXT, remind_at TEXT, \
        reminded INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, \
        color TEXT NOT NULL DEFAULT '#7aa2f7', position INTEGER NOT NULL DEFAULT 0, \
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);";

    async fn pool() -> SqlitePool {
        let p = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(CREATE).execute(&p).await.unwrap();
        p
    }

    // Regression: the createTask INSERT (9 columns, distinct placeholders) must
    // round-trip including a NULL bind for remind_at.
    #[tokio::test]
    async fn create_task_insert_ok() {
        let p = pool().await;
        sqlx::query(
            "INSERT INTO tasks (title, notes, scheduled_date, start_time, end_time, remind_at, color, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind("t").bind("").bind("2026-06-24").bind("02:02").bind("13:02")
        .bind(Option::<String>::None).bind("#7aa2f7").bind("2026-06-24T02:02:00").bind("2026-06-24T02:02:00")
        .execute(&p)
        .await
        .unwrap();
        let row = sqlx::query("SELECT COUNT(*) AS c FROM tasks").fetch_one(&p).await.unwrap();
        let c: i64 = row.get("c");
        assert_eq!(c, 1);
    }
}
