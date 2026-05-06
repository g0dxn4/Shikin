use std::{
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const DB_FILE_NAME: &str = "shikin.db";

fn ensure_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "refusing to use non-directory app data path {}",
                path.display()
            ),
        ));
    }

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;

    Ok(())
}

fn set_private_file_mode(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;

    Ok(())
}

fn backup_suffix() -> String {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "unknown-time".into())
}

fn sqlite_family_members(
    source_dir: &Path,
    target_dir: &Path,
    target_name: &str,
) -> Vec<(PathBuf, PathBuf)> {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .filter_map(|suffix| {
            let source_path = source_dir.join(format!("{DB_FILE_NAME}{suffix}"));
            if !source_path.exists() {
                return None;
            }

            Some((
                source_path,
                target_dir.join(format!("{target_name}{suffix}")),
            ))
        })
        .collect()
}

fn remove_orphaned_app_data_sidecars(app_data_dir: &Path) {
    if app_data_dir.join(DB_FILE_NAME).exists() {
        return;
    }

    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar_path = app_data_dir.join(format!("{DB_FILE_NAME}{suffix}"));
        if !sidecar_path.exists() {
            continue;
        }

        if let Err(error) = fs::remove_file(&sidecar_path) {
            eprintln!(
                "warning: could not remove orphaned app data SQLite sidecar {}: {error}",
                sidecar_path.display()
            );
        }
    }
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!("warning: could not clean up {}: {error}", path.display());
            }
        }
    }
}

fn move_sqlite_family(source_dir: &Path, target_dir: &Path, target_name: &str) -> io::Result<bool> {
    let source_db_path = source_dir.join(DB_FILE_NAME);
    if !source_db_path.exists() {
        return Ok(false);
    }

    let members = sqlite_family_members(source_dir, target_dir, target_name);
    if let Some((_, target_path)) = members.iter().find(|(_, target_path)| target_path.exists()) {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!(
                "target SQLite file already exists: {}",
                target_path.display()
            ),
        ));
    }

    let stamp = backup_suffix();
    let mut staged_members: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new();
    let mut promoted_targets: Vec<PathBuf> = Vec::new();

    let result: io::Result<()> = (|| {
        for (source_path, target_path) in members {
            let target_file_name = target_path.file_name().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid SQLite target path")
            })?;
            let temp_path = target_path.with_file_name(format!(
                "{}.tmp-{stamp}",
                target_file_name.to_string_lossy()
            ));

            fs::copy(&source_path, &temp_path)?;
            set_private_file_mode(&temp_path)?;
            staged_members.push((source_path, temp_path, target_path));
        }

        for (_, temp_path, target_path) in &staged_members {
            if target_path.exists() {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "target SQLite file already exists: {}",
                        target_path.display()
                    ),
                ));
            }
            fs::rename(temp_path, target_path)?;
            promoted_targets.push(target_path.clone());
            set_private_file_mode(target_path)?;
        }

        Ok(())
    })();

    if let Err(error) = result {
        let temp_paths: Vec<PathBuf> = staged_members
            .iter()
            .map(|(_, temp_path, _)| temp_path.clone())
            .collect();
        cleanup_paths(&temp_paths);
        cleanup_paths(&promoted_targets);
        return Err(error);
    }

    for (source_path, _, _) in &staged_members {
        if let Err(error) = fs::remove_file(source_path) {
            eprintln!(
                "warning: migrated {}, but could not remove the legacy source file: {error}",
                source_path.display()
            );
        }
    }

    Ok(true)
}

fn migrate_app_config_db_to_app_data(app_config_dir: &Path, app_data_dir: &Path) -> io::Result<()> {
    if app_config_dir == app_data_dir {
        return Ok(());
    }

    let old_db_path = app_config_dir.join(DB_FILE_NAME);
    let new_db_path = app_data_dir.join(DB_FILE_NAME);

    if !old_db_path.exists() {
        return Ok(());
    }

    if new_db_path.exists() {
        let backup_name = format!("{DB_FILE_NAME}.app-config-backup-{}", backup_suffix());
        eprintln!(
            "warning: both AppConfig and AppData databases exist; keeping AppData and moving the legacy AppConfig database to {}",
            app_data_dir.join(&backup_name).display()
        );
        if let Err(error) = move_sqlite_family(app_config_dir, app_data_dir, &backup_name) {
            eprintln!("warning: could not preserve the legacy AppConfig database backup: {error}");
        }
        return Ok(());
    }

    remove_orphaned_app_data_sidecars(app_data_dir);
    move_sqlite_family(app_config_dir, app_data_dir, DB_FILE_NAME).map(|_| ())
}

fn prepare_app_data_db(identifier: &str) -> io::Result<()> {
    let app_data_dir = dirs::data_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no app data path was found"))?;
    let app_data_dir = app_data_dir.join(identifier);
    ensure_private_dir(&app_data_dir)?;

    if let Some(config_dir) = dirs::config_dir() {
        migrate_app_config_db_to_app_data(&config_dir.join(identifier), &app_data_dir)?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    if let Err(error) = prepare_app_data_db(&context.config().identifier) {
        eprintln!("error: could not prepare the Shikin app data database: {error}");
        std::process::exit(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, process};

    fn temp_test_dir(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "shikin-{name}-{}-{}",
            process::id(),
            backup_suffix()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn migrates_app_config_sqlite_family_to_app_data() {
        let root = temp_test_dir("app-config-migration");
        let app_config_dir = root.join("config");
        let app_data_dir = root.join("data");
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(app_config_dir.join(DB_FILE_NAME), "legacy-db").unwrap();
        fs::write(
            app_config_dir.join(format!("{DB_FILE_NAME}-wal")),
            "legacy-wal",
        )
        .unwrap();
        fs::write(
            app_config_dir.join(format!("{DB_FILE_NAME}-journal")),
            "legacy-journal",
        )
        .unwrap();

        migrate_app_config_db_to_app_data(&app_config_dir, &app_data_dir).unwrap();

        assert_eq!(
            fs::read_to_string(app_data_dir.join(DB_FILE_NAME)).unwrap(),
            "legacy-db"
        );
        assert_eq!(
            fs::read_to_string(app_data_dir.join(format!("{DB_FILE_NAME}-wal"))).unwrap(),
            "legacy-wal"
        );
        assert_eq!(
            fs::read_to_string(app_data_dir.join(format!("{DB_FILE_NAME}-journal"))).unwrap(),
            "legacy-journal"
        );
        assert!(!app_config_dir.join(DB_FILE_NAME).exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removes_orphaned_app_data_sidecars_before_migration() {
        let root = temp_test_dir("orphan-sidecars");
        let app_config_dir = root.join("config");
        let app_data_dir = root.join("data");
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(app_config_dir.join(DB_FILE_NAME), "legacy-db").unwrap();
        fs::write(
            app_data_dir.join(format!("{DB_FILE_NAME}-wal")),
            "orphaned-wal",
        )
        .unwrap();
        fs::write(
            app_data_dir.join(format!("{DB_FILE_NAME}-journal")),
            "orphaned-journal",
        )
        .unwrap();

        migrate_app_config_db_to_app_data(&app_config_dir, &app_data_dir).unwrap();

        assert_eq!(
            fs::read_to_string(app_data_dir.join(DB_FILE_NAME)).unwrap(),
            "legacy-db"
        );
        assert!(!app_data_dir.join(format!("{DB_FILE_NAME}-wal")).exists());
        assert!(!app_data_dir
            .join(format!("{DB_FILE_NAME}-journal"))
            .exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_app_config_database_as_backup_when_app_data_db_exists() {
        let root = temp_test_dir("app-config-conflict");
        let app_config_dir = root.join("config");
        let app_data_dir = root.join("data");
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(app_config_dir.join(DB_FILE_NAME), "legacy-db").unwrap();
        fs::write(app_data_dir.join(DB_FILE_NAME), "current-db").unwrap();

        migrate_app_config_db_to_app_data(&app_config_dir, &app_data_dir).unwrap();

        assert_eq!(
            fs::read_to_string(app_data_dir.join(DB_FILE_NAME)).unwrap(),
            "current-db"
        );
        let backup_path = fs::read_dir(&app_data_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("shikin.db.app-config-backup-")
            })
            .expect("expected app-config backup database");
        assert_eq!(fs::read_to_string(backup_path).unwrap(), "legacy-db");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skips_migration_when_app_config_and_app_data_dirs_match() {
        let root = temp_test_dir("same-config-data-dir");
        let app_dir = root.join("same");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(app_dir.join(DB_FILE_NAME), "current-db").unwrap();

        migrate_app_config_db_to_app_data(&app_dir, &app_dir).unwrap();

        assert_eq!(
            fs::read_to_string(app_dir.join(DB_FILE_NAME)).unwrap(),
            "current-db"
        );
        assert!(fs::read_dir(&app_dir).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("shikin.db.app-config-backup-")
        }));

        fs::remove_dir_all(root).unwrap();
    }
}
