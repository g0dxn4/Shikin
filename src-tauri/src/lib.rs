mod database_snapshot;

use std::{
    ffi::{OsStr, OsString},
    fs, io,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex as StdMutex,
    },
    time::{Duration, Instant, SystemTime},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{
    sqlite::{SqliteArguments, SqliteConnectOptions, SqliteConnection, SqliteValueRef},
    Column, ConnectOptions, Executor, Row, Sqlite, TypeInfo, Value, ValueRef,
};
use tauri::{Manager, State};
use tokio::sync::Mutex;

const DB_FILE_NAME: &str = "shikin.db";
const APP_IDENTIFIER: &str = "com.asf.shikin";
const CLI_SUPPORT_DIR: &str = "cli-support";
const CLI_BRIDGE_BIN: &str = "shikin-bridge";
const MCP_BRIDGE_BIN: &str = "shikin-mcp";
const NODE_PATH_FILE_NAME: &str = "node-path";
const SETTINGS_FILE_NAME: &str = "settings.json";
const CLOSE_TO_TRAY_KEY: &str = "close_to_tray_enabled";
const DEFAULT_CLOSE_TO_TRAY_ENABLED: bool = true;
const WEB_SERVER_ENABLED_KEY: &str = "web_server_enabled";
const WEB_SERVER_PORT_KEY: &str = "web_server_port";
const DEFAULT_WEB_SERVER_ENABLED: bool = false;
const DEFAULT_WEB_SERVER_PORT: u16 = 8480;
const WEB_SERVER_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const WEB_SERVER_STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(50);
const MAIN_WINDOW_LABEL: &str = "main";
const DATABASE_TRANSACTION_TTL: Duration = Duration::from_secs(120);
const TRAY_MENU_SHOW_ID: &str = "show_shikin";
const TRAY_MENU_QUIT_ID: &str = "quit_shikin";

#[derive(Default)]
struct ShikinDbState {
    inner: Mutex<ShikinDbInner>,
}

#[derive(Default)]
struct ShikinDbInner {
    connection: Option<SqliteConnection>,
    active_transaction_id: Option<String>,
    transaction_generation: u64,
}

#[derive(Default)]
struct WebServerState {
    inner: StdMutex<WebServerInner>,
}

#[derive(Default)]
struct WebServerInner {
    child: Option<Child>,
    port: Option<u16>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebServerStatus {
    running: bool,
    port: Option<u16>,
    error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WebServerSettings {
    enabled: bool,
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShikinDbStatement {
    transaction_id: String,
    query: String,
    values: Vec<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShikinDbExecuteResult {
    rows_affected: u64,
    last_insert_id: i64,
}

static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BridgeKind {
    Cli,
    Mcp,
}

impl BridgeKind {
    fn bin_name(self) -> &'static str {
        match self {
            Self::Cli => CLI_BRIDGE_BIN,
            Self::Mcp => MCP_BRIDGE_BIN,
        }
    }

    fn source_script_name(self) -> &'static str {
        match self {
            Self::Cli => "cli.js",
            Self::Mcp => "mcp-server.js",
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
enum EntrypointMode {
    Gui,
    Bridge {
        kind: BridgeKind,
        args: Vec<OsString>,
    },
}

fn classify_entrypoint_args<I, S>(args: I) -> EntrypointMode
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let mut args = args.into_iter().map(Into::into);
    let _program = args.next();
    let mut command_args: Vec<OsString> = args.collect();

    if command_args.is_empty() {
        return EntrypointMode::Gui;
    }

    if command_args
        .first()
        .is_some_and(|arg| arg == OsStr::new("mcp"))
    {
        command_args.remove(0);
        return EntrypointMode::Bridge {
            kind: BridgeKind::Mcp,
            args: command_args,
        };
    }

    EntrypointMode::Bridge {
        kind: BridgeKind::Cli,
        args: command_args,
    }
}

fn status_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

fn source_bridge_script(kind: BridgeKind) -> Option<PathBuf> {
    let script_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../cli/dist")
        .join(kind.source_script_name());

    script_path.is_file().then_some(script_path)
}

fn installed_bridge_script(kind: BridgeKind) -> io::Result<Option<PathBuf>> {
    let Some(data_dir) = dirs::data_dir() else {
        return Ok(None);
    };
    let support_dir = data_dir.join(APP_IDENTIFIER).join(CLI_SUPPORT_DIR);
    let script_path = support_dir.join("dist").join(kind.source_script_name());
    if !script_path.is_file() {
        return Ok(None);
    }

    let package_path = support_dir.join("package.json");
    let package_contents = fs::read_to_string(&package_path).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "installed Shikin automation support has no readable package metadata ({error}); reinstall it"
            ),
        )
    })?;
    let package: serde_json::Value = serde_json::from_str(&package_contents).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "installed Shikin automation support has invalid package metadata ({error}); reinstall it"
            ),
        )
    })?;
    let installed_version = package
        .get("version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let expected_version = env!("CARGO_PKG_VERSION");
    if installed_version != expected_version {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "installed Shikin automation support version {installed_version:?} is incompatible with desktop version {expected_version}; reinstall automation support"
            ),
        ));
    }

    Ok(Some(script_path))
}

fn settings_file_path(identifier: &str) -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(identifier).join(SETTINGS_FILE_NAME))
}

fn close_to_tray_setting_from_json(settings: &serde_json::Value) -> bool {
    settings
        .get(CLOSE_TO_TRAY_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(DEFAULT_CLOSE_TO_TRAY_ENABLED)
}

fn close_to_tray_enabled(identifier: &str) -> bool {
    let Some(settings_path) = settings_file_path(identifier) else {
        return DEFAULT_CLOSE_TO_TRAY_ENABLED;
    };

    let Ok(contents) = fs::read_to_string(settings_path) else {
        return DEFAULT_CLOSE_TO_TRAY_ENABLED;
    };

    serde_json::from_str::<serde_json::Value>(&contents)
        .map(|settings| close_to_tray_setting_from_json(&settings))
        .unwrap_or(DEFAULT_CLOSE_TO_TRAY_ENABLED)
}

fn valid_web_server_port(port: u64) -> Option<u16> {
    (1024..=u16::MAX as u64)
        .contains(&port)
        .then_some(port as u16)
}

fn web_server_settings_from_json(settings: &serde_json::Value) -> WebServerSettings {
    let enabled = settings
        .get(WEB_SERVER_ENABLED_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(DEFAULT_WEB_SERVER_ENABLED);
    let port = settings
        .get(WEB_SERVER_PORT_KEY)
        .and_then(serde_json::Value::as_u64)
        .and_then(valid_web_server_port)
        .unwrap_or(DEFAULT_WEB_SERVER_PORT);

    WebServerSettings { enabled, port }
}

fn web_server_settings(identifier: &str) -> WebServerSettings {
    let Some(settings_path) = settings_file_path(identifier) else {
        return WebServerSettings {
            enabled: DEFAULT_WEB_SERVER_ENABLED,
            port: DEFAULT_WEB_SERVER_PORT,
        };
    };

    let Ok(contents) = fs::read_to_string(settings_path) else {
        return WebServerSettings {
            enabled: DEFAULT_WEB_SERVER_ENABLED,
            port: DEFAULT_WEB_SERVER_PORT,
        };
    };

    serde_json::from_str::<serde_json::Value>(&contents)
        .map(|settings| web_server_settings_from_json(&settings))
        .unwrap_or(WebServerSettings {
            enabled: DEFAULT_WEB_SERVER_ENABLED,
            port: DEFAULT_WEB_SERVER_PORT,
        })
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn installed_node_executable(script_path: &Path) -> Option<PathBuf> {
    let support_dir = script_path.parent()?.parent()?;
    let configured_path = fs::read_to_string(support_dir.join(NODE_PATH_FILE_NAME)).ok()?;
    let configured_path = PathBuf::from(configured_path.trim());
    (configured_path.is_absolute() && is_executable_file(&configured_path))
        .then_some(configured_path)
}

fn node_executable(script_path: &Path) -> OsString {
    if let Some(configured_path) = installed_node_executable(script_path) {
        return configured_path.into_os_string();
    }

    #[cfg(target_os = "macos")]
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        let path = Path::new(candidate);
        if is_executable_file(path) {
            return path.as_os_str().to_owned();
        }
    }

    OsString::from("node")
}

fn node_script_command(script_path: &Path, args: &[OsString]) -> Command {
    let mut command = Command::new(node_executable(script_path));
    command.arg(script_path).args(args);
    command
}

fn run_node_script(script_path: &Path, args: &[OsString]) -> io::Result<i32> {
    node_script_command(script_path, args)
        .status()
        .map(status_code)
}

fn bridge_command(kind: BridgeKind) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(kind.bin_name());
        command
    }

    #[cfg(not(windows))]
    {
        Command::new(kind.bin_name())
    }
}

fn run_bridge(kind: BridgeKind, args: &[OsString]) -> io::Result<i32> {
    if let Some(script_path) = source_bridge_script(kind) {
        match run_node_script(&script_path, args) {
            Ok(code) => return Ok(code),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    if let Some(script_path) = installed_bridge_script(kind)? {
        match run_node_script(&script_path, args) {
            Ok(code) => return Ok(code),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    let mut command = bridge_command(kind);
    command.args(args);
    command.status().map(status_code)
}

fn web_server_args(port: u16) -> Vec<OsString> {
    vec![
        OsString::from("web"),
        OsString::from("--port"),
        OsString::from(port.to_string()),
    ]
}

fn spawn_web_server(port: u16) -> io::Result<Child> {
    let args = web_server_args(port);

    if let Some(script_path) = source_bridge_script(BridgeKind::Cli) {
        match node_script_command(&script_path, &args).spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    if let Some(script_path) = installed_bridge_script(BridgeKind::Cli)? {
        match node_script_command(&script_path, &args).spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    let mut command = bridge_command(BridgeKind::Cli);
    command.args(args);
    command.spawn()
}

fn validate_web_server_port(port: u64) -> Result<u16, String> {
    valid_web_server_port(port)
        .ok_or_else(|| "Hosted web server port must be between 1024 and 65535.".into())
}

fn preflight_web_server_port(port: u16) -> Result<(), String> {
    TcpListener::bind(("127.0.0.1", port))
        .map(drop)
        .map_err(|error| format!("Port {port} is unavailable on 127.0.0.1: {error}"))
}

fn web_server_exit_message(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("Hosted web server exited during startup with exit code {code}."),
        None => "Hosted web server exited during startup.".into(),
    }
}

fn web_server_status(inner: &mut WebServerInner) -> WebServerStatus {
    if let Some(wait_result) = inner.child.as_mut().map(Child::try_wait) {
        match wait_result {
            Ok(None) => {
                return WebServerStatus {
                    running: true,
                    port: inner.port,
                    error: inner.last_error.clone(),
                };
            }
            Ok(Some(status)) => {
                inner.child = None;
                inner.port = None;
                inner.last_error = Some(match status.code() {
                    Some(code) => format!("Hosted web server exited with exit code {code}."),
                    None => "Hosted web server exited.".into(),
                });
            }
            Err(error) => {
                inner.last_error =
                    Some(format!("Could not read hosted web server status: {error}"));
                return WebServerStatus {
                    running: true,
                    port: inner.port,
                    error: inner.last_error.clone(),
                };
            }
        }
    }

    WebServerStatus {
        running: false,
        port: None,
        error: inner.last_error.clone(),
    }
}

fn stop_web_server(inner: &mut WebServerInner) -> Result<(), String> {
    let Some(mut child) = inner.child.take() else {
        inner.port = None;
        return Ok(());
    };
    let port = inner.port.take();

    let stopped = match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => match child.kill() {
            Ok(()) => child.wait().map(|_| ()),
            Err(error) => match child.try_wait() {
                Ok(Some(_)) => Ok(()),
                Ok(None) | Err(_) => Err(error),
            },
        },
        Err(error) => Err(error),
    };

    match stopped {
        Ok(()) => Ok(()),
        Err(error) => {
            inner.child = Some(child);
            inner.port = port;
            Err(format!("Could not stop hosted web server: {error}"))
        }
    }
}

fn start_web_server(inner: &mut WebServerInner, port: u16) -> Result<(), String> {
    let mut child = spawn_web_server(port)
        .map_err(|error| format!("Could not start hosted web server: {error}"))?;
    let deadline = Instant::now() + WEB_SERVER_STARTUP_TIMEOUT;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Err(web_server_exit_message(status)),
            Ok(None) => {}
            Err(error) => {
                inner.child = Some(child);
                inner.port = Some(port);
                return Err(format!(
                    "Could not verify hosted web server startup: {error}"
                ));
            }
        }

        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            inner.child = Some(child);
            inner.port = Some(port);
            inner.last_error = None;
            return Ok(());
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Hosted web server did not listen on 127.0.0.1:{port} within {} seconds.",
                WEB_SERVER_STARTUP_TIMEOUT.as_secs()
            ));
        }

        std::thread::sleep(WEB_SERVER_STARTUP_POLL_INTERVAL);
    }
}

fn apply_web_server_settings_to_state(
    state: &WebServerState,
    enabled: bool,
    port: u64,
) -> WebServerStatus {
    let Ok(mut inner) = state.inner.lock() else {
        return WebServerStatus {
            running: false,
            port: None,
            error: Some("Hosted web server state is unavailable.".into()),
        };
    };

    let port = match validate_web_server_port(port) {
        Ok(port) => port,
        Err(error) => {
            inner.last_error = Some(error);
            return web_server_status(&mut inner);
        }
    };

    let current_status = web_server_status(&mut inner);
    if !enabled {
        if let Err(error) = stop_web_server(&mut inner) {
            inner.last_error = Some(error);
        } else {
            inner.last_error = None;
        }
        return web_server_status(&mut inner);
    }

    if current_status.running && current_status.port == Some(port) {
        inner.last_error = None;
        return web_server_status(&mut inner);
    }

    if let Err(error) = preflight_web_server_port(port) {
        inner.last_error = Some(error);
        return web_server_status(&mut inner);
    }

    if let Err(error) = stop_web_server(&mut inner) {
        inner.last_error = Some(error);
        return web_server_status(&mut inner);
    }

    if let Err(error) = start_web_server(&mut inner, port) {
        inner.last_error = Some(error);
    }

    web_server_status(&mut inner)
}

fn stop_web_server_on_exit(state: &WebServerState) {
    let Ok(mut inner) = state.inner.lock() else {
        eprintln!("warning: hosted web server state was unavailable during shutdown");
        return;
    };

    if let Err(error) = stop_web_server(&mut inner) {
        eprintln!("warning: {error}");
    }
}

#[tauri::command]
fn get_web_server_status(state: State<WebServerState>) -> WebServerStatus {
    let Ok(mut inner) = state.inner.lock() else {
        return WebServerStatus {
            running: false,
            port: None,
            error: Some("Hosted web server state is unavailable.".into()),
        };
    };

    web_server_status(&mut inner)
}

#[tauri::command]
fn apply_web_server_settings(
    enabled: bool,
    port: u64,
    state: State<WebServerState>,
) -> WebServerStatus {
    apply_web_server_settings_to_state(&state, enabled, port)
}

fn print_bridge_error(kind: BridgeKind, error: &io::Error) {
    eprintln!(
        "error: could not start Shikin {} support: {error}",
        match kind {
            BridgeKind::Cli => "command-line",
            BridgeKind::Mcp => "MCP",
        }
    );
    eprintln!();
    eprintln!("Install the local automation support:");
    eprintln!(
        "  curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh"
    );
    eprintln!();

    match kind {
        BridgeKind::Cli => {
            eprintln!("Then run commands with `shikin <command>`.");
        }
        BridgeKind::Mcp => {
            eprintln!("Then start MCP with `shikin mcp`.");
        }
    }
}

pub fn run_entrypoint<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    match classify_entrypoint_args(args) {
        EntrypointMode::Gui => {
            run();
            0
        }
        EntrypointMode::Bridge { kind, args } => match run_bridge(kind, &args) {
            Ok(code) => code,
            Err(error) => {
                print_bridge_error(kind, &error);
                1
            }
        },
    }
}

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

async fn open_sqlite_connection_at_path(path: &Path) -> Result<SqliteConnection, String> {
    let mut connection = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .connect()
        .await
        .map_err(|error| error.to_string())?;
    connection
        .execute("PRAGMA foreign_keys = ON")
        .await
        .map_err(|error| error.to_string())?;

    Ok(connection)
}

async fn open_shikin_sqlite_connection(app: &tauri::AppHandle) -> Result<SqliteConnection, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ensure_private_dir(&app_data_dir).map_err(|error| error.to_string())?;

    let db_path = app_data_dir.join(DB_FILE_NAME);
    let connection = open_sqlite_connection_at_path(&db_path).await?;
    if db_path.exists() {
        set_private_file_mode(&db_path).map_err(|error| error.to_string())?;
    }

    Ok(connection)
}

fn bind_json_values<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
    values: Vec<JsonValue>,
) -> sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>> {
    for value in values {
        query = match value {
            JsonValue::Null => query.bind(None::<JsonValue>),
            JsonValue::Bool(value) => query.bind(value),
            JsonValue::Number(value) => {
                if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) = value.as_u64() {
                    query.bind(value as i64)
                } else {
                    query.bind(value.as_f64().unwrap_or_default())
                }
            }
            JsonValue::String(value) => query.bind(value),
            value => query.bind(value),
        };
    }

    query
}

fn sqlite_value_to_json(value: SqliteValueRef<'_>) -> Result<JsonValue, String> {
    if value.is_null() {
        return Ok(JsonValue::Null);
    }

    let json = match value.type_info().name() {
        "TEXT" => value
            .to_owned()
            .try_decode::<String>()
            .map(JsonValue::String)
            .unwrap_or(JsonValue::Null),
        "REAL" => value
            .to_owned()
            .try_decode::<f64>()
            .map(JsonValue::from)
            .unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => value
            .to_owned()
            .try_decode::<i64>()
            .map(JsonValue::from)
            .unwrap_or(JsonValue::Null),
        "BOOLEAN" => value
            .to_owned()
            .try_decode::<bool>()
            .map(JsonValue::Bool)
            .unwrap_or(JsonValue::Null),
        "BLOB" => value
            .to_owned()
            .try_decode::<Vec<u8>>()
            .map(|bytes| bytes.into_iter().map(JsonValue::from).collect())
            .map(JsonValue::Array)
            .unwrap_or(JsonValue::Null),
        "NULL" => JsonValue::Null,
        other => return Err(format!("unsupported SQLite datatype: {other}")),
    };

    Ok(json)
}

async fn execute_on_shikin_connection(
    connection: &mut SqliteConnection,
    query: String,
    values: Vec<JsonValue>,
) -> Result<ShikinDbExecuteResult, String> {
    let result = bind_json_values(sqlx::query(&query), values)
        .execute(connection)
        .await
        .map_err(|error| error.to_string())?;

    Ok(ShikinDbExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

async fn select_on_shikin_connection(
    connection: &mut SqliteConnection,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<serde_json::Map<String, JsonValue>>, String> {
    let rows = bind_json_values(sqlx::query(&query), values)
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;
    let mut result = Vec::with_capacity(rows.len());

    for row in rows {
        let mut object = serde_json::Map::new();
        for (index, column) in row.columns().iter().enumerate() {
            let value = row.try_get_raw(index).map_err(|error| error.to_string())?;
            object.insert(column.name().to_string(), sqlite_value_to_json(value)?);
        }
        result.push(object);
    }

    Ok(result)
}

fn ensure_active_transaction<'a>(
    state: &'a mut ShikinDbInner,
    transaction_id: &str,
) -> Result<&'a mut SqliteConnection, String> {
    match state.active_transaction_id.as_deref() {
        Some(active_transaction_id) if active_transaction_id == transaction_id => state
            .connection
            .as_mut()
            .ok_or_else(|| "database transaction connection is not available".to_string()),
        Some(_) => Err("another database transaction is active".to_string()),
        None => Err("no database transaction is active".to_string()),
    }
}

#[tauri::command]
async fn shikin_db_tx_begin(
    app: tauri::AppHandle,
    state: State<'_, ShikinDbState>,
    transaction_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.active_transaction_id.is_some() {
        return Err("another database transaction is already active".to_string());
    }

    let mut connection = open_shikin_sqlite_connection(&app).await?;
    execute_on_shikin_connection(&mut connection, "BEGIN IMMEDIATE".to_string(), vec![]).await?;

    guard.connection = Some(connection);
    guard.active_transaction_id = Some(transaction_id.clone());
    guard.transaction_generation = guard.transaction_generation.wrapping_add(1);
    let generation = guard.transaction_generation;
    drop(guard);

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DATABASE_TRANSACTION_TTL).await;
        let state = app.state::<ShikinDbState>();
        let mut guard = state.inner.lock().await;
        if guard.active_transaction_id.as_deref() != Some(transaction_id.as_str())
            || guard.transaction_generation != generation
        {
            return;
        }
        if let Some(connection) = guard.connection.as_mut() {
            let _ = execute_on_shikin_connection(connection, "ROLLBACK".to_string(), vec![]).await;
        }
        guard.active_transaction_id = None;
        guard.connection = None;
    });

    Ok(())
}

#[tauri::command]
async fn shikin_db_tx_execute(
    state: State<'_, ShikinDbState>,
    statement: ShikinDbStatement,
) -> Result<ShikinDbExecuteResult, String> {
    let mut guard = state.inner.lock().await;
    let connection = ensure_active_transaction(&mut guard, &statement.transaction_id)?;
    execute_on_shikin_connection(connection, statement.query, statement.values).await
}

#[tauri::command]
async fn shikin_db_tx_query(
    state: State<'_, ShikinDbState>,
    statement: ShikinDbStatement,
) -> Result<Vec<serde_json::Map<String, JsonValue>>, String> {
    let mut guard = state.inner.lock().await;
    let connection = ensure_active_transaction(&mut guard, &statement.transaction_id)?;
    select_on_shikin_connection(connection, statement.query, statement.values).await
}

#[tauri::command]
async fn shikin_db_tx_commit(
    state: State<'_, ShikinDbState>,
    transaction_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let connection = ensure_active_transaction(&mut guard, &transaction_id)?;
    execute_on_shikin_connection(connection, "COMMIT".to_string(), vec![]).await?;
    guard.active_transaction_id = None;
    guard.connection = None;
    Ok(())
}

#[tauri::command]
async fn shikin_db_tx_rollback(
    state: State<'_, ShikinDbState>,
    transaction_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let rollback_result = match ensure_active_transaction(&mut guard, &transaction_id) {
        Ok(connection) => {
            execute_on_shikin_connection(connection, "ROLLBACK".to_string(), vec![]).await
        }
        Err(error) => Err(error),
    };
    guard.active_transaction_id = None;
    guard.connection = None;
    rollback_result.map(|_| ())
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

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .or_else(|| app.webview_windows().into_values().next());

    if let Some(window) = window {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW_ID, "Show Shikin", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "Quit Shikin", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Shikin")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => show_main_window(app),
            TRAY_MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    TRAY_AVAILABLE.store(true, Ordering::Relaxed);
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ShikinDbState::default())
        .manage(WebServerState::default())
        .invoke_handler(tauri::generate_handler![
            shikin_db_tx_begin,
            shikin_db_tx_execute,
            shikin_db_tx_query,
            shikin_db_tx_commit,
            shikin_db_tx_rollback,
            database_snapshot::shikin_db_create_snapshot,
            database_snapshot::shikin_db_restore_snapshot,
            get_web_server_status,
            apply_web_server_settings,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(error) = setup_tray(app) {
                eprintln!("warning: could not start Shikin tray support: {error}");
            }

            let settings = web_server_settings(APP_IDENTIFIER);
            if settings.enabled {
                let status = apply_web_server_settings_to_state(
                    app.state::<WebServerState>().inner(),
                    settings.enabled,
                    settings.port.into(),
                );
                if let Some(error) = status.error {
                    eprintln!("warning: could not start hosted web server: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if TRAY_AVAILABLE.load(Ordering::Relaxed) && close_to_tray_enabled(APP_IDENTIFIER) {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("warning: could not hide Shikin window to tray: {error}");
                    }
                }
            }
        })
        .build(context)
        .expect("error while building Tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_web_server_on_exit(app_handle.state::<WebServerState>().inner());
            }
        });
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

    fn os_args(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    #[test]
    fn shikin_db_transaction_helpers_commit_on_one_connection() {
        tauri::async_runtime::block_on(async {
            let root = temp_test_dir("db-tx-commit");
            let db_path = root.join(DB_FILE_NAME);
            let mut connection = open_sqlite_connection_at_path(&db_path).await.unwrap();

            execute_on_shikin_connection(
                &mut connection,
                "CREATE TABLE accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL)".into(),
                vec![],
            )
            .await
            .unwrap();
            execute_on_shikin_connection(&mut connection, "BEGIN IMMEDIATE".into(), vec![])
                .await
                .unwrap();
            execute_on_shikin_connection(
                &mut connection,
                "INSERT INTO accounts (id, balance) VALUES (?, ?)".into(),
                vec![JsonValue::String("acct-1".into()), JsonValue::from(100)],
            )
            .await
            .unwrap();
            execute_on_shikin_connection(
                &mut connection,
                "UPDATE accounts SET balance = balance - ? WHERE id = ?".into(),
                vec![JsonValue::from(25), JsonValue::String("acct-1".into())],
            )
            .await
            .unwrap();
            execute_on_shikin_connection(&mut connection, "COMMIT".into(), vec![])
                .await
                .unwrap();

            let rows = select_on_shikin_connection(
                &mut connection,
                "SELECT balance FROM accounts WHERE id = ?".into(),
                vec![JsonValue::String("acct-1".into())],
            )
            .await
            .unwrap();

            assert_eq!(rows[0].get("balance"), Some(&JsonValue::from(75)));
            fs::remove_dir_all(root).unwrap();
        });
    }

    #[test]
    fn shikin_db_transaction_helpers_rollback_on_one_connection() {
        tauri::async_runtime::block_on(async {
            let root = temp_test_dir("db-tx-rollback");
            let db_path = root.join(DB_FILE_NAME);
            let mut connection = open_sqlite_connection_at_path(&db_path).await.unwrap();

            execute_on_shikin_connection(
                &mut connection,
                "CREATE TABLE transactions (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)".into(),
                vec![],
            )
            .await
            .unwrap();
            execute_on_shikin_connection(&mut connection, "BEGIN IMMEDIATE".into(), vec![])
                .await
                .unwrap();
            execute_on_shikin_connection(
                &mut connection,
                "INSERT INTO transactions (id, amount) VALUES (?, ?)".into(),
                vec![JsonValue::String("tx-1".into()), JsonValue::from(1200)],
            )
            .await
            .unwrap();
            execute_on_shikin_connection(&mut connection, "ROLLBACK".into(), vec![])
                .await
                .unwrap();

            let rows = select_on_shikin_connection(
                &mut connection,
                "SELECT COUNT(*) AS count FROM transactions".into(),
                vec![],
            )
            .await
            .unwrap();

            assert_eq!(rows[0].get("count"), Some(&JsonValue::from(0)));
            fs::remove_dir_all(root).unwrap();
        });
    }

    #[test]
    fn classifies_empty_invocation_as_gui() {
        assert_eq!(
            classify_entrypoint_args(os_args(&["shikin"])),
            EntrypointMode::Gui
        );
    }

    #[test]
    fn classifies_finance_args_as_cli_bridge() {
        assert_eq!(
            classify_entrypoint_args(os_args(&["shikin", "list-accounts", "--json"])),
            EntrypointMode::Bridge {
                kind: BridgeKind::Cli,
                args: os_args(&["list-accounts", "--json"]),
            }
        );
    }

    #[test]
    fn classifies_mcp_subcommand_as_mcp_bridge() {
        assert_eq!(
            classify_entrypoint_args(os_args(&["shikin", "mcp", "--verbose"])),
            EntrypointMode::Bridge {
                kind: BridgeKind::Mcp,
                args: os_args(&["--verbose"]),
            }
        );
    }

    #[test]
    fn defaults_web_server_settings_when_values_are_missing_or_invalid() {
        assert_eq!(
            web_server_settings_from_json(&serde_json::json!({})),
            WebServerSettings {
                enabled: false,
                port: 8480,
            }
        );
        assert_eq!(
            web_server_settings_from_json(&serde_json::json!({
                WEB_SERVER_ENABLED_KEY: "invalid",
                WEB_SERVER_PORT_KEY: 1023,
            })),
            WebServerSettings {
                enabled: false,
                port: 8480,
            }
        );
    }

    #[test]
    fn reads_web_server_settings_from_json() {
        assert_eq!(
            web_server_settings_from_json(&serde_json::json!({
                WEB_SERVER_ENABLED_KEY: true,
                WEB_SERVER_PORT_KEY: 9000,
            })),
            WebServerSettings {
                enabled: true,
                port: 9000,
            }
        );
    }

    #[test]
    fn validates_web_server_port_range() {
        assert_eq!(validate_web_server_port(1024), Ok(1024));
        assert_eq!(validate_web_server_port(65535), Ok(65535));
        assert!(validate_web_server_port(1023).is_err());
        assert!(validate_web_server_port(65536).is_err());
    }

    #[test]
    fn builds_web_server_cli_argument_shape() {
        assert_eq!(web_server_args(8480), os_args(&["web", "--port", "8480"]));
    }

    #[test]
    fn uses_the_node_executable_recorded_with_installed_support() {
        let root = temp_test_dir("installed-node-path");
        let support_dir = root.join("cli-support");
        let dist_dir = support_dir.join("dist");
        let script_path = dist_dir.join("cli.js");
        let node_path = root.join("node");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(&script_path, "").unwrap();
        fs::write(&node_path, "").unwrap();

        #[cfg(unix)]
        fs::set_permissions(&node_path, fs::Permissions::from_mode(0o700)).unwrap();

        fs::write(
            support_dir.join(NODE_PATH_FILE_NAME),
            format!("{}\n", node_path.display()),
        )
        .unwrap();

        let command = node_script_command(&script_path, &web_server_args(8480));
        assert_eq!(command.get_program(), node_path.as_os_str());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn web_server_state_helpers_report_stopped_and_reject_invalid_ports() {
        let state = WebServerState::default();

        assert_eq!(
            apply_web_server_settings_to_state(&state, false, 8480),
            WebServerStatus {
                running: false,
                port: None,
                error: None,
            }
        );
        let invalid_port = apply_web_server_settings_to_state(&state, false, 1023);
        assert!(!invalid_port.running);
        assert_eq!(invalid_port.port, None);
        assert_eq!(
            invalid_port.error.as_deref(),
            Some("Hosted web server port must be between 1024 and 65535.")
        );
    }

    #[test]
    fn defaults_close_to_tray_setting_to_enabled() {
        assert!(close_to_tray_setting_from_json(&serde_json::json!({})));
        assert!(close_to_tray_setting_from_json(&serde_json::json!({
            CLOSE_TO_TRAY_KEY: "invalid"
        })));
    }

    #[test]
    fn reads_close_to_tray_setting_boolean() {
        assert!(close_to_tray_setting_from_json(&serde_json::json!({
            CLOSE_TO_TRAY_KEY: true
        })));
        assert!(!close_to_tray_setting_from_json(&serde_json::json!({
            CLOSE_TO_TRAY_KEY: false
        })));
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
