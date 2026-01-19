#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::State;

const DISCORD_APP_ID: &str = "1462683110612144348";
const MAX_TITLE_LENGTH: usize = 128;
const MAX_AUTHOR_LENGTH: usize = 128;

#[derive(Debug)]
pub struct DiscordRpcClient {
    client: Option<DiscordIpcClient>,
    current_book_hash: Option<String>,
}

impl DiscordRpcClient {
    pub fn new() -> Self {
        DiscordRpcClient {
            client: None,
            current_book_hash: None,
        }
    }

    fn ensure_connected(&mut self) -> Result<(), String> {
        if self.client.is_some() {
            return Ok(());
        }

        let mut client = DiscordIpcClient::new(DISCORD_APP_ID);
        match client.connect() {
            Ok(_) => {
                log::info!("Successfully connected to Discord");
                self.client = Some(client);
                Ok(())
            }
            Err(e) => {
                log::warn!("Failed to connect to Discord: {}", e);
                Err(format!("Failed to connect to Discord: {}", e))
            }
        }
    }

    fn disconnect(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.close();
            log::debug!("Disconnected from Discord");
        }
        self.current_book_hash = None;
    }

    fn truncate_string(s: &str, max_len: usize) -> String {
        if s.len() <= max_len {
            s.to_string()
        } else {
            format!("{}...", &s[..max_len - 3])
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPresenceData {
    book_hash: String,
    title: String,
    author: Option<String>,
    cover_url: Option<String>,
    session_start: i64,
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
#[tauri::command]
pub async fn update_book_presence(
    state: State<'_, Arc<Mutex<DiscordRpcClient>>>,
    presence: BookPresenceData,
) -> Result<(), String> {
    let mut client = state
        .lock()
        .map_err(|e| format!("Mutex lock error: {}", e))?;

    if let Err(e) = client.ensure_connected() {
        log::debug!("Discord not available: {}", e);
        return Ok(());
    }

    let BookPresenceData {
        book_hash,
        title,
        author,
        cover_url,
        session_start,
    } = presence;

    // Truncate title and author to avoid Discord API limits
    let truncated_title = DiscordRpcClient::truncate_string(&title, MAX_TITLE_LENGTH);
    let state_text = if let Some(ref author_name) = author {
        let truncated_author = DiscordRpcClient::truncate_string(author_name, MAX_AUTHOR_LENGTH);
        format!("by {}", truncated_author)
    } else {
        String::new()
    };

    let mut activity_builder = activity::Activity::new().details(&truncated_title);

    if !state_text.is_empty() {
        activity_builder = activity_builder.state(&state_text);
    }

    activity_builder =
        activity_builder.timestamps(activity::Timestamps::new().start(session_start / 1000));

    let large_image = cover_url
        .as_deref()
        .filter(|url| url.starts_with("https://"))
        .unwrap_or("book_icon");
    let assets_builder = activity::Assets::new()
        .large_image(large_image)
        .large_text(&truncated_title);

    activity_builder = activity_builder.assets(assets_builder);

    let button = activity::Button::new("Read on Readest", "https://web.readest.com");
    activity_builder = activity_builder.buttons(vec![button]);

    if let Some(ref mut discord_client) = client.client {
        match discord_client.set_activity(activity_builder) {
            Ok(_) => {
                log::info!("Successfully updated Discord presence");
                client.current_book_hash = Some(book_hash);
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to update Discord activity: {}", e);
                client.disconnect();
                Err(format!("Failed to update Discord activity: {}", e))
            }
        }
    } else {
        Err("Discord client not initialized".to_string())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
#[tauri::command]
pub async fn clear_book_presence(
    state: State<'_, Arc<Mutex<DiscordRpcClient>>>,
) -> Result<(), String> {
    let mut client = state
        .lock()
        .map_err(|e| format!("Mutex lock error: {}", e))?;

    if let Some(ref mut discord_client) = client.client {
        match discord_client.clear_activity() {
            Ok(_) => {
                log::info!("Successfully cleared Discord presence");
                client.current_book_hash = None;
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to clear Discord activity: {}", e);
                client.disconnect();
                Ok(())
            }
        }
    } else {
        log::debug!("No Discord client to clear");
        client.current_book_hash = None;
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
#[tauri::command]
pub async fn update_book_presence(_presence: BookPresenceData) -> Result<(), String> {
    Ok(()) // No-op on non-desktop platforms
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
#[tauri::command]
pub async fn clear_book_presence() -> Result<(), String> {
    Ok(()) // No-op on non-desktop platforms
}
