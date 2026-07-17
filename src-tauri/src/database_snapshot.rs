use std::{
    ffi::{CStr, CString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use libsqlite3_sys::{
    sqlite3, sqlite3_backup_finish, sqlite3_backup_init, sqlite3_backup_step, sqlite3_errmsg,
    SQLITE_BUSY, SQLITE_DONE, SQLITE_LOCKED, SQLITE_OK,
};
use serde::Serialize;
use sqlx::{Connection, Executor};
use tauri::Manager;

use super::{
    backup_suffix, ensure_private_dir, open_sqlite_connection_at_path, set_private_file_mode,
};

const BACKUP_BUSY_RETRIES: usize = 100;
const BACKUP_BUSY_DELAY: Duration = Duration::from_millis(25);
const HOSTED_PROCESS_FILE_NAME: &str = ".shikin-web.pid";
const RESTORE_LOCK_FILE_NAME: &str = "shikin.db.restore.lock";

struct RestoreOperationLock {
    path: PathBuf,
}

impl Drop for RestoreOperationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn acquire_restore_operation_lock(app_data_dir: &Path) -> Result<RestoreOperationLock, String> {
    let path = app_data_dir.join(RESTORE_LOCK_FILE_NAME);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options.open(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!(
                "Another database restore appears to be in progress ({}).",
                path.display()
            )
        } else {
            format!("Could not acquire database restore lock: {error}")
        }
    })?;
    if let Err(error) = write!(file, "{{\"pid\":{}}}", std::process::id()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("Could not write database restore lock: {error}"));
    }
    drop(file);
    set_private_file_mode(&path).map_err(|error| {
        let _ = fs::remove_file(&path);
        error.to_string()
    })?;

    Ok(RestoreOperationLock { path })
}

#[cfg(unix)]
fn process_is_running(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(true)
}

#[cfg(windows)]
fn process_is_running(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).contains(&format!("\",\"{pid}\",\""))
        }
        _ => true,
    }
}

#[cfg(not(any(unix, windows)))]
fn process_is_running(_pid: u32) -> bool {
    true
}

fn assert_hosted_web_stopped(app_data_dir: &Path) -> Result<(), String> {
    let marker_path = app_data_dir.join(HOSTED_PROCESS_FILE_NAME);
    if !marker_path.exists() {
        return Ok(());
    }

    let marker: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&marker_path)
            .map_err(|error| format!("Could not read hosted web process marker: {error}"))?,
    )
    .map_err(|error| format!("Hosted web process marker is invalid: {error}"))?;
    let pid = marker
        .get("pid")
        .and_then(serde_json::Value::as_u64)
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .ok_or_else(|| "Hosted web process marker has no valid process id.".to_string())?;

    if process_is_running(pid) {
        return Err(
            "Stop hosted web access before restoring the database. This prevents concurrent financial writes from being lost."
                .to_string(),
        );
    }

    fs::remove_file(&marker_path)
        .map_err(|error| format!("Could not remove stale hosted web process marker: {error}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotRestoreResult {
    rollback_path: Option<String>,
}

fn sqlite_message(handle: *mut sqlite3, context: &str) -> String {
    let message = unsafe {
        let pointer = sqlite3_errmsg(handle);
        if pointer.is_null() {
            "unknown SQLite error".to_string()
        } else {
            CStr::from_ptr(pointer).to_string_lossy().into_owned()
        }
    };
    format!("{context}: {message}")
}

async fn copy_sqlite_database(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    if !source_path.is_file() {
        return Err(format!(
            "SQLite backup source does not exist: {}",
            source_path.display()
        ));
    }

    if let Some(parent) = destination_path.parent() {
        ensure_private_dir(parent).map_err(|error| error.to_string())?;
    }

    let mut source = open_sqlite_connection_at_path(source_path).await?;
    let mut destination = open_sqlite_connection_at_path(destination_path).await?;

    let copy_result = {
        let mut source_handle = source
            .lock_handle()
            .await
            .map_err(|error| error.to_string())?;
        let mut destination_handle = destination
            .lock_handle()
            .await
            .map_err(|error| error.to_string())?;
        let source_raw = source_handle.as_raw_handle().as_ptr();
        let destination_raw = destination_handle.as_raw_handle().as_ptr();
        let main = CString::new("main").expect("main contains no nul bytes");

        unsafe {
            let backup =
                sqlite3_backup_init(destination_raw, main.as_ptr(), source_raw, main.as_ptr());
            if backup.is_null() {
                Err(sqlite_message(
                    destination_raw,
                    "Could not initialize SQLite online backup",
                ))
            } else {
                let mut retries = 0usize;
                let step_code = loop {
                    let code = sqlite3_backup_step(backup, 256);
                    match code {
                        SQLITE_DONE => break SQLITE_DONE,
                        SQLITE_OK => continue,
                        SQLITE_BUSY | SQLITE_LOCKED if retries < BACKUP_BUSY_RETRIES => {
                            retries += 1;
                            thread::sleep(BACKUP_BUSY_DELAY);
                        }
                        other => break other,
                    }
                };
                let finish_code = sqlite3_backup_finish(backup);

                if step_code != SQLITE_DONE {
                    Err(sqlite_message(
                        destination_raw,
                        "SQLite online backup did not complete",
                    ))
                } else if finish_code != SQLITE_OK {
                    Err(sqlite_message(
                        destination_raw,
                        "Could not finalize SQLite online backup",
                    ))
                } else {
                    Ok(())
                }
            }
        }
    };

    copy_result?;
    destination
        .execute("PRAGMA wal_checkpoint(TRUNCATE)")
        .await
        .map_err(|error| error.to_string())?;
    destination
        .close()
        .await
        .map_err(|error| error.to_string())?;
    source.close().await.map_err(|error| error.to_string())?;
    set_private_file_mode(destination_path).map_err(|error| error.to_string())?;
    Ok(())
}

async fn validate_database(path: &Path) -> Result<(), String> {
    let mut connection = open_sqlite_connection_at_path(path).await?;

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!("SQLite integrity check failed: {integrity}"));
    }

    if sqlx::query("PRAGMA foreign_key_check")
        .fetch_optional(&mut connection)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err("SQLite foreign-key check failed".to_string());
    }

    for table in ["_migrations", "accounts", "categories", "transactions"] {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
        if exists != 1 {
            return Err(format!(
                "Imported database is missing required table {table}"
            ));
        }
    }

    let core_migration = sqlx::query("SELECT 1 FROM _migrations WHERE name = ? LIMIT 1")
        .bind("001_core_tables")
        .fetch_optional(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if core_migration.is_none() {
        return Err("Imported database is missing required migration metadata".to_string());
    }

    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn app_data_database_path(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ensure_private_dir(&app_data_dir).map_err(|error| error.to_string())?;
    Ok((app_data_dir.clone(), app_data_dir.join(super::DB_FILE_NAME)))
}

fn require_app_data_file(app_data_dir: &Path, candidate_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(candidate_path);
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_app_data = app_data_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if !canonical_candidate.starts_with(&canonical_app_data) {
        return Err("Restore candidate must be staged in Shikin's app-data directory".to_string());
    }
    Ok(canonical_candidate)
}

#[tauri::command]
pub(crate) async fn shikin_db_create_snapshot(app: tauri::AppHandle) -> Result<String, String> {
    let (app_data_dir, database_path) = app_data_database_path(&app)?;
    let snapshot_path = app_data_dir.join(format!(".shikin-export-{}.db", backup_suffix()));
    let _ = fs::remove_file(&snapshot_path);

    let result = async {
        copy_sqlite_database(&database_path, &snapshot_path).await?;
        validate_database(&snapshot_path).await?;
        Ok(snapshot_path.to_string_lossy().into_owned())
    }
    .await;

    if result.is_err() {
        let _ = fs::remove_file(&snapshot_path);
    }
    result
}

#[tauri::command]
pub(crate) async fn shikin_db_restore_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::ShikinDbState>,
    candidate_path: String,
) -> Result<SnapshotRestoreResult, String> {
    let guard = state.inner.lock().await;
    if guard.active_transaction_id.is_some() {
        return Err("Cannot restore while a database transaction is active".to_string());
    }

    let (app_data_dir, database_path) = app_data_database_path(&app)?;
    let _restore_lock = acquire_restore_operation_lock(&app_data_dir)?;
    assert_hosted_web_stopped(&app_data_dir)?;
    let candidate = require_app_data_file(&app_data_dir, &candidate_path)?;
    validate_database(&candidate).await?;

    let rollback_path = if database_path.exists() {
        let backup_dir = app_data_dir.join("backups");
        ensure_private_dir(&backup_dir).map_err(|error| error.to_string())?;
        let rollback = backup_dir.join(format!("rollback-shikin-{}.db", backup_suffix()));
        copy_sqlite_database(&database_path, &rollback).await?;
        validate_database(&rollback).await?;
        Some(rollback)
    } else {
        None
    };

    let restore_result = match copy_sqlite_database(&candidate, &database_path).await {
        Ok(()) => validate_database(&database_path).await,
        Err(error) => Err(error),
    };

    if let Err(restore_error) = restore_result {
        if let Some(rollback) = rollback_path.as_ref() {
            if let Err(rollback_error) = copy_sqlite_database(rollback, &database_path).await {
                return Err(format!(
                    "Restore failed ({restore_error}) and rollback failed ({rollback_error}). Manual rollback: {}",
                    rollback.display()
                ));
            }
        }
        return Err(format!("Restore failed: {restore_error}"));
    }

    drop(guard);
    Ok(SnapshotRestoreResult {
        rollback_path: rollback_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use std::{env, process};

    fn temp_snapshot_dir(name: &str) -> PathBuf {
        let root = env::temp_dir().join(format!(
            "shikin-snapshot-{name}-{}-{}",
            process::id(),
            super::super::backup_suffix()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn restore_lock_is_exclusive_and_released_on_drop() {
        let root = temp_snapshot_dir("restore-lock");
        let lock = acquire_restore_operation_lock(&root).unwrap();
        assert!(acquire_restore_operation_lock(&root).is_err());
        drop(lock);
        assert!(acquire_restore_operation_lock(&root).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_refuses_a_running_hosted_web_process() {
        let root = temp_snapshot_dir("hosted-process");
        fs::write(
            root.join(HOSTED_PROCESS_FILE_NAME),
            format!("{{\"pid\":{}}}", process::id()),
        )
        .unwrap();

        let error = assert_hosted_web_stopped(&root).unwrap_err();
        assert!(error.contains("Stop hosted web access"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sqlite_online_backup_copies_wal_content() {
        tauri::async_runtime::block_on(async {
            let root = env::temp_dir().join(format!(
                "shikin-snapshot-test-{}-{}",
                process::id(),
                super::super::backup_suffix()
            ));
            fs::create_dir_all(&root).unwrap();
            let source = root.join("source.db");
            let destination = root.join("destination.db");

            let mut source_db = open_sqlite_connection_at_path(&source).await.unwrap();
            source_db
                .execute("PRAGMA journal_mode = WAL")
                .await
                .unwrap();
            source_db
                .execute("CREATE TABLE values_table (value TEXT NOT NULL)")
                .await
                .unwrap();
            source_db
                .execute("INSERT INTO values_table (value) VALUES ('copied')")
                .await
                .unwrap();

            copy_sqlite_database(&source, &destination).await.unwrap();
            let mut copied = open_sqlite_connection_at_path(&destination).await.unwrap();
            let row = sqlx::query("SELECT value FROM values_table")
                .fetch_one(&mut copied)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("value"), "copied");

            copied.close().await.unwrap();
            source_db.close().await.unwrap();
            fs::remove_dir_all(root).unwrap();
        });
    }
}
