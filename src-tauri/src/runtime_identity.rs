use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Row};
use tauri::Manager;

const IDENTITY_FILE_NAME: &str = "runtime-identity.json";
const DATABASE_FILE_NAME: &str = "shikin.db";
const IDENTITY_VERSION: u8 = 1;
const MAX_IDENTITY_BYTES: u64 = 1024;
const CURRENT_SCHEMA_VERSION: i64 = 21;
const CURRENT_SCHEMA_MIGRATION: &str = "021_backend_remediation_foundation";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdentityDocument {
    version: u8,
    local_instance_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum RuntimeIdentityStatus {
    #[serde(rename = "available")]
    Available { id: String },
    #[serde(rename = "unavailable")]
    Unavailable { reason: &'static str },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    success: bool,
    build: &'static str,
    version: &'static str,
    schema_version: i64,
    schema_migration: String,
    database_lineage_id: String,
    local_instance: RuntimeIdentityStatus,
    data_revision: i64,
    last_financial_write_at: Option<String>,
}

fn valid_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 || ![8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-') {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
    {
        return false;
    }
    matches!(bytes[14].to_ascii_lowercase(), b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
}

fn identity_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(IDENTITY_FILE_NAME)
}

fn validated_root(app_data_dir: &Path) -> io::Result<PathBuf> {
    let metadata = fs::symlink_metadata(app_data_dir)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe storage root",
        ));
    }
    app_data_dir.canonicalize()
}

fn parse_identity(mut file: File) -> RuntimeIdentityStatus {
    let Ok(metadata) = file.metadata() else {
        return RuntimeIdentityStatus::Unavailable {
            reason: "unreadable",
        };
    };
    if !metadata.is_file() || metadata.len() > MAX_IDENTITY_BYTES {
        return RuntimeIdentityStatus::Unavailable { reason: "invalid" };
    }

    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
        return RuntimeIdentityStatus::Unavailable {
            reason: "unreadable",
        };
    }
    let Ok(document) = serde_json::from_str::<IdentityDocument>(&contents) else {
        return RuntimeIdentityStatus::Unavailable { reason: "invalid" };
    };
    if document.version != IDENTITY_VERSION || !valid_uuid(&document.local_instance_id) {
        return RuntimeIdentityStatus::Unavailable { reason: "invalid" };
    }

    RuntimeIdentityStatus::Available {
        id: document.local_instance_id.to_ascii_lowercase(),
    }
}

pub fn read(app_data_dir: &Path) -> RuntimeIdentityStatus {
    let Ok(canonical_root) = validated_root(app_data_dir) else {
        return if app_data_dir.exists() {
            RuntimeIdentityStatus::Unavailable { reason: "unsafe" }
        } else {
            RuntimeIdentityStatus::Unavailable { reason: "missing" }
        };
    };
    let path = identity_path(app_data_dir);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return RuntimeIdentityStatus::Unavailable { reason: "missing" };
        }
        Err(_) => {
            return RuntimeIdentityStatus::Unavailable {
                reason: "unreadable",
            }
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return RuntimeIdentityStatus::Unavailable { reason: "unsafe" };
    }
    let Ok(canonical_path) = path.canonicalize() else {
        return RuntimeIdentityStatus::Unavailable {
            reason: "unreadable",
        };
    };
    if canonical_path.parent() != Some(canonical_root.as_path()) {
        return RuntimeIdentityStatus::Unavailable { reason: "unsafe" };
    }
    match File::open(path) {
        Ok(file) => parse_identity(file),
        Err(_) => RuntimeIdentityStatus::Unavailable {
            reason: "unreadable",
        },
    }
}

pub fn initialize(app_data_dir: &Path, candidate_id: &str) -> Result<String, String> {
    let normalized = candidate_id.trim().to_ascii_lowercase();
    if !valid_uuid(&normalized) {
        return Err("Runtime identity candidate must be a UUID.".into());
    }
    validated_root(app_data_dir).map_err(|_| "Runtime identity storage root is unsafe.")?;
    let path = identity_path(app_data_dir);
    let document = IdentityDocument {
        version: IDENTITY_VERSION,
        local_instance_id: normalized.clone(),
    };
    let bytes =
        serde_json::to_vec(&document).map_err(|_| "Could not serialize runtime identity.")?;

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);

    match options.open(&path) {
        Ok(mut file) => {
            let write_result = file
                .write_all(&bytes)
                .and_then(|_| file.write_all(b"\n"))
                .and_then(|_| file.sync_all());
            drop(file);
            if write_result.is_err() {
                let _ = fs::remove_file(&path);
                return Err("Could not persist runtime identity.".into());
            }
            #[cfg(unix)]
            if fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).is_err() {
                let _ = fs::remove_file(&path);
                return Err("Could not secure runtime identity.".into());
            }
            Ok(normalized)
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            // Another process/thread may have won create_new but not yet flushed
            // the short document. Bounded retries distinguish that race from a
            // persistently corrupt identity without ever overwriting either.
            let mut status = read(app_data_dir);
            for _ in 0..20 {
                if matches!(status, RuntimeIdentityStatus::Available { .. }) {
                    break;
                }
                if matches!(
                    status,
                    RuntimeIdentityStatus::Unavailable {
                        reason: "unsafe" | "missing"
                    }
                ) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
                status = read(app_data_dir);
            }
            match status {
                RuntimeIdentityStatus::Available { id } => Ok(id),
                RuntimeIdentityStatus::Unavailable { reason } => Err(format!(
                    "Existing runtime identity is {reason}; refusing to replace it."
                )),
            }
        }
        Err(_) => Err("Could not exclusively create runtime identity.".into()),
    }
}

#[tauri::command]
pub fn initialize_runtime_identity(
    app: tauri::AppHandle,
    local_instance_id: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "App data is unavailable.")?;
    initialize(&app_data_dir, &local_instance_id)
}

#[tauri::command]
pub async fn read_runtime_diagnostics(app: tauri::AppHandle) -> Result<RuntimeDiagnostics, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "App data is unavailable.")?;
    let root = validated_root(&app_data_dir)
        .map_err(|_| "Runtime diagnostics storage is unavailable.".to_string())?;
    let db_path = app_data_dir.join(DATABASE_FILE_NAME);
    let metadata = fs::symlink_metadata(&db_path)
        .map_err(|_| "Runtime diagnostics database is unavailable.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Runtime diagnostics database is unsafe.".into());
    }
    let canonical_db = db_path
        .canonicalize()
        .map_err(|_| "Runtime diagnostics database is unavailable.".to_string())?;
    if canonical_db.parent() != Some(root.as_path()) {
        return Err("Runtime diagnostics database is unsafe.".into());
    }

    let mut connection = SqliteConnectOptions::new()
        .filename(&db_path)
        .read_only(true)
        .create_if_missing(false)
        .disable_statement_logging()
        .connect()
        .await
        .map_err(|_| "Runtime diagnostics database could not be opened.".to_string())?;
    let migration = sqlx::query("SELECT id, name FROM _migrations ORDER BY id DESC LIMIT 1")
        .fetch_optional(&mut connection)
        .await
        .map_err(|_| "Runtime diagnostics schema metadata is unavailable.".to_string())?
        .ok_or_else(|| "Runtime diagnostics schema metadata is unavailable.".to_string())?;
    let schema_version: i64 = migration
        .try_get("id")
        .map_err(|_| "Invalid schema version.")?;
    let schema_migration: String = migration
        .try_get("name")
        .map_err(|_| "Invalid schema migration metadata.")?;
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err("Database schema is newer than this application.".into());
    }
    if schema_version != CURRENT_SCHEMA_VERSION || schema_migration != CURRENT_SCHEMA_MIGRATION {
        return Err("Database schema is not ready for runtime diagnostics.".into());
    }

    let state = sqlx::query(
        "SELECT database_id, data_revision, last_financial_write_at FROM app_data_state WHERE id = 1",
    )
    .fetch_optional(&mut connection)
    .await
    .map_err(|_| "Runtime diagnostics metadata is unavailable.".to_string())?
    .ok_or_else(|| "Runtime diagnostics metadata is unavailable.".to_string())?;

    Ok(RuntimeDiagnostics {
        success: true,
        build: "desktop",
        version: env!("CARGO_PKG_VERSION"),
        schema_version,
        schema_migration,
        database_lineage_id: state
            .try_get("database_id")
            .map_err(|_| "Invalid database lineage metadata.")?,
        local_instance: read(&app_data_dir),
        data_revision: state
            .try_get("data_revision")
            .map_err(|_| "Invalid database revision metadata.")?,
        last_financial_write_at: state
            .try_get("last_financial_write_at")
            .map_err(|_| "Invalid last-write metadata.")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env,
        sync::Arc,
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "shikin-runtime-identity-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn read_before_initialization_creates_nothing() {
        let root = temp_dir("read-empty");
        assert_eq!(
            read(&root),
            RuntimeIdentityStatus::Unavailable { reason: "missing" }
        );
        assert!(!identity_path(&root).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initialization_is_stable_and_exclusive_under_concurrency() {
        let root = Arc::new(temp_dir("concurrent"));
        let candidates = [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        ];
        let handles = candidates
            .into_iter()
            .map(|candidate| {
                let root = Arc::clone(&root);
                thread::spawn(move || initialize(&root, candidate).unwrap())
            })
            .collect::<Vec<_>>();
        let ids = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert!(ids.iter().all(|id| id == &ids[0]));
        assert_eq!(
            read(&root),
            RuntimeIdentityStatus::Available { id: ids[0].clone() }
        );
        fs::remove_dir_all(root.as_path()).unwrap();
    }

    #[test]
    fn corrupt_identity_is_rejected_without_overwrite() {
        let root = temp_dir("corrupt");
        let path = identity_path(&root);
        fs::write(&path, "not-json").unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            read(&root),
            RuntimeIdentityStatus::Unavailable { reason: "invalid" }
        );
        assert!(initialize(&root, "11111111-1111-4111-8111-111111111111").is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_identity_is_rejected_without_touching_target() {
        use std::os::unix::fs::symlink;
        let root = temp_dir("symlink");
        let target = root.join("target");
        fs::write(&target, "outside").unwrap();
        symlink(&target, identity_path(&root)).unwrap();
        assert_eq!(
            read(&root),
            RuntimeIdentityStatus::Unavailable { reason: "unsafe" }
        );
        assert!(initialize(&root, "11111111-1111-4111-8111-111111111111").is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "outside");
        fs::remove_dir_all(root).unwrap();
    }
}
