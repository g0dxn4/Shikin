use serde::Serialize;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};

use std::collections::HashMap;

#[derive(Serialize)]
pub struct OAuthCallback {
    pub code: String,
    pub state: String,
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html><head><title>Authorization Complete</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#020202;color:#e4e4e7}
.card{text-align:center;padding:2rem}h1{font-size:1.25rem;margin-bottom:0.5rem;color:#bf5af2}p{color:#71717a;font-size:0.875rem}</style>
</head><body><div class="card"><h1>Authorization successful</h1><p>You can close this tab and return to Valute.</p></div></body></html>"#;

/// Start a one-shot HTTP server on localhost to catch an OAuth redirect.
#[tauri::command]
async fn oauth_listen(port: u16) -> Result<OAuthCallback, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("Bind error on port {port}: {e}"))?;

    let (mut stream, _) = timeout(Duration::from_secs(120), listener.accept())
        .await
        .map_err(|_| "OAuth callback timed out (120s)".to_string())?
        .map_err(|e| format!("Accept error: {e}"))?;

    let (reader_half, mut writer_half) = stream.split();
    let reader = BufReader::new(reader_half);
    let mut lines = reader.lines();

    let request_line = lines
        .next_line()
        .await
        .map_err(|e| format!("Read error: {e}"))?
        .ok_or_else(|| "No request received".to_string())?;

    // Parse "GET /auth/callback?code=X&state=Y HTTP/1.1"
    let request_path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Invalid HTTP request".to_string())?
        .to_string();

    let (_actual_path, query) = request_path
        .split_once('?')
        .ok_or_else(|| "No query parameters in callback".to_string())?;

    let params: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    // Check for OAuth error
    if let Some(error) = params.get("error") {
        let desc = params.get("error_description").cloned().unwrap_or_default();
        return Err(format!(
            "OAuth error: {error}{}",
            if desc.is_empty() {
                String::new()
            } else {
                format!(" — {desc}")
            }
        ));
    }

    let code = params
        .get("code")
        .ok_or_else(|| "Missing 'code' parameter in callback".to_string())?
        .clone();
    let state = params
        .get("state")
        .ok_or_else(|| "Missing 'state' parameter in callback".to_string())?
        .clone();

    // Drain remaining HTTP headers
    loop {
        match lines.next_line().await {
            Ok(Some(line)) if !line.is_empty() => continue,
            _ => break,
        }
    }

    // Send success response
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        SUCCESS_HTML.len(),
        SUCCESS_HTML
    );
    let _ = writer_half.write_all(response.as_bytes()).await;
    let _ = writer_half.flush().await;

    Ok(OAuthCallback { code, state })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create core tables",
            sql: include_str!("../migrations/001_core_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "ai memories",
            sql: include_str!("../migrations/002_ai_memories.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "credit card fields",
            sql: include_str!("../migrations/003_credit_cards.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:valute.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![oauth_listen])
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
