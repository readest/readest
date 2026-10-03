//! Desktop Now Playing: the OS media controls (macOS Now Playing, Windows
//! SMTC, Linux MPRIS) via souvlaki. It backs the same media-session commands
//! and `media-session-*` listener events the mobile plugins provide, so
//! TauriMediaSession drives it unchanged.
//!
//! souvlaki's Windows controls are COM objects bound to the thread that made
//! them, so every call runs on the main thread and the controls live in a
//! main-thread-local.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
#[cfg(not(target_os = "macos"))]
use souvlaki::MediaMetadata;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection,
};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime};

use crate::models::*;

pub(crate) type Listeners = Arc<Mutex<HashMap<String, Vec<Channel<Value>>>>>;

#[derive(Default)]
struct Session {
    controls: Option<MediaControls>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover: Option<PathBuf>,
    #[cfg(target_os = "macos")]
    artwork: Option<objc2::rc::Retained<objc2_media_player::MPMediaItemArtwork>>,
    duration: Option<Duration>,
    playing: bool,
    position: Option<Duration>,
}

impl Session {
    fn push_metadata(&mut self) {
        let Some(controls) = self.controls.as_mut() else {
            return;
        };
        // souvlaki's macOS set_metadata replaces the whole now-playing
        // dictionary and reloads the cover asynchronously, so the widget
        // flashed a blank cover on every sentence. Merge instead, as the iOS
        // plugin does, keeping the artwork object in place.
        #[cfg(target_os = "macos")]
        {
            let _ = controls;
            macos::write_info(
                self.title.as_deref(),
                self.artist.as_deref(),
                self.album.as_deref(),
                self.duration,
                self.artwork.as_deref(),
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            let cover_url = self.cover.as_deref().and_then(file_url);
            let _ = controls.set_metadata(MediaMetadata {
                title: self.title.as_deref(),
                artist: self.artist.as_deref(),
                album: self.album.as_deref(),
                cover_url: cover_url.as_deref(),
                duration: self.duration,
            });
        }
        self.push_playback();
    }

    fn push_playback(&mut self) {
        let Some(controls) = self.controls.as_mut() else {
            return;
        };
        let progress = self.position.map(MediaPosition);
        let _ = controls.set_playback(if self.playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        });
    }
}

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session::default());
}

fn on_main<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut Session) + Send + 'static) {
    let _ = app.run_on_main_thread(move || SESSION.with(|s| f(&mut s.borrow_mut())));
}

fn emit(listeners: &Listeners, event: &str, payload: Value) {
    if let Some(channels) = listeners.lock().unwrap().get(event) {
        for channel in channels {
            let _ = channel.send(payload.clone());
        }
    }
}

fn dispatch(listeners: &Listeners, event: MediaControlEvent) {
    let (name, payload) = match event {
        MediaControlEvent::Play => ("media-session-play", Value::Null),
        // Stop has no listener of its own; the bridge maps it to pause anyway.
        MediaControlEvent::Pause | MediaControlEvent::Stop => ("media-session-pause", Value::Null),
        MediaControlEvent::Toggle => ("media-session-toggle", Value::Null),
        MediaControlEvent::Next => ("media-session-next", Value::Null),
        MediaControlEvent::Previous => ("media-session-previous", Value::Null),
        MediaControlEvent::Seek(SeekDirection::Forward)
        | MediaControlEvent::SeekBy(SeekDirection::Forward, _) => {
            ("media-session-seek-forward", Value::Null)
        }
        MediaControlEvent::Seek(SeekDirection::Backward)
        | MediaControlEvent::SeekBy(SeekDirection::Backward, _) => {
            ("media-session-seek-backward", Value::Null)
        }
        MediaControlEvent::SetPosition(MediaPosition(position)) => (
            "media-session-seek",
            json!({ "position": position.as_millis() as f64 }),
        ),
        _ => return,
    };
    emit(listeners, name, payload);
}

fn create_controls<R: Runtime>(app: &AppHandle<R>, listeners: Listeners) -> Option<MediaControls> {
    #[cfg(target_os = "windows")]
    let hwnd = {
        let window = app.webview_windows().into_values().next()?;
        Some(window.hwnd().ok()?.0 as *mut std::ffi::c_void)
    };
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = app;
        None
    };
    let config = PlatformConfig {
        display_name: "Readest",
        dbus_name: "readest",
        hwnd,
    };
    let mut controls = MediaControls::new(config)
        .map_err(|e| log_error("create", e))
        .ok()?;
    controls
        .attach(move |event| dispatch(&listeners, event))
        .map_err(|e| log_error("attach", e))
        .ok()?;
    Some(controls)
}

fn log_error(what: &str, error: impl std::fmt::Debug) {
    eprintln!("Now Playing: failed to {what} media controls: {error:?}");
}

pub(crate) fn set_active<R: Runtime>(
    app: &AppHandle<R>,
    listeners: &Listeners,
    payload: SetMediaSessionActiveRequest,
) {
    let handle = app.clone();
    let listeners = listeners.clone();
    on_main(app, move |session| {
        if payload.active {
            if session.controls.is_none() {
                session.controls = create_controls(&handle, listeners);
            }
            return;
        }
        if let Some(controls) = session.controls.as_mut() {
            // Clear the card before detaching: macOS keeps the last
            // now-playing info around after the command handlers go.
            let _ = controls.set_playback(MediaPlayback::Stopped);
            #[cfg(target_os = "macos")]
            macos::clear_info();
            #[cfg(not(target_os = "macos"))]
            let _ = controls.set_metadata(MediaMetadata::default());
        }
        *session = Session::default();
    });
}

pub(crate) fn update_state<R: Runtime>(
    app: &AppHandle<R>,
    payload: UpdateMediaSessionStateRequest,
) {
    on_main(app, move |session| {
        session.playing = payload.playing;
        if let Some(position) = payload.position {
            session.position = Some(Duration::from_secs_f64(position.max(0.0) / 1000.0));
        }
        let duration = payload
            .duration
            .map(|d| Duration::from_secs_f64(d.max(0.0) / 1000.0));
        if duration.is_some() && duration != session.duration {
            session.duration = duration;
            session.push_metadata();
        } else {
            session.push_playback();
        }
    });
}

pub(crate) fn update_metadata<R: Runtime>(
    app: &AppHandle<R>,
    payload: UpdateMediaSessionMetadataRequest,
) {
    let cover = payload
        .artwork
        .as_deref()
        .and_then(|artwork| write_cover(app, artwork));
    on_main(app, move |session| {
        session.title = payload.title;
        session.artist = payload.artist;
        session.album = payload.album;
        if let Some(cover) = cover {
            #[cfg(target_os = "macos")]
            {
                session.artwork = macos::artwork(&cover);
            }
            session.cover = Some(cover);
        }
        session.push_metadata();
    });
}

// The bridge sends the cover once per session as a data URL; the OS loaders
// want a URL they can open, so it goes through a file in the app cache.
fn write_cover<R: Runtime>(app: &AppHandle<R>, artwork: &str) -> Option<PathBuf> {
    let (header, data) = artwork.strip_prefix("data:")?.split_once(";base64,")?;
    let ext = match header {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    let dir: PathBuf = app.path().app_cache_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("now-playing-cover.{ext}"));
    std::fs::write(&path, bytes).ok()?;
    Some(path)
}

#[cfg(not(target_os = "macos"))]
fn file_url(path: &std::path::Path) -> Option<String> {
    // souvlaki's Windows loader strips "file://" and opens the rest as a path.
    #[cfg(target_os = "windows")]
    return Some(format!("file://{}", path.display()));
    #[cfg(not(target_os = "windows"))]
    return tauri::Url::from_file_path(path).ok().map(String::from);
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::Path;
    use std::ptr::NonNull;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::CGSize;
    use objc2_foundation::{NSMutableDictionary, NSNumber, NSString};
    use objc2_media_player::{
        MPMediaItemArtwork, MPMediaItemPropertyAlbumTitle, MPMediaItemPropertyArtist,
        MPMediaItemPropertyArtwork, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
        MPNowPlayingInfoCenter,
    };

    pub fn artwork(path: &Path) -> Option<Retained<MPMediaItemArtwork>> {
        let path = NSString::from_str(path.to_str()?);
        let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &path)?;
        let size = image.size();
        let handler = RcBlock::new(move |_: CGSize| NonNull::from(&*image));
        Some(unsafe {
            MPMediaItemArtwork::initWithBoundsSize_requestHandler(
                MPMediaItemArtwork::alloc(),
                size,
                &handler,
            )
        })
    }

    pub fn write_info(
        title: Option<&str>,
        artist: Option<&str>,
        album: Option<&str>,
        duration: Option<Duration>,
        artwork: Option<&MPMediaItemArtwork>,
    ) {
        unsafe {
            let center = MPNowPlayingInfoCenter::defaultCenter();
            let info = NSMutableDictionary::<NSString, AnyObject>::new();
            if let Some(previous) = center.nowPlayingInfo() {
                info.addEntriesFromDictionary(&previous);
            }
            let strings = [
                (MPMediaItemPropertyTitle, title),
                (MPMediaItemPropertyArtist, artist),
                (MPMediaItemPropertyAlbumTitle, album),
            ];
            for (key, value) in strings {
                match value {
                    Some(value) => info.insert(key, &*NSString::from_str(value)),
                    None => info.removeObjectForKey(key),
                }
            }
            if let Some(duration) = duration {
                let seconds = NSNumber::new_f64(duration.as_secs_f64());
                info.insert(MPMediaItemPropertyPlaybackDuration, &*seconds);
            }
            if let Some(artwork) = artwork {
                info.insert(MPMediaItemPropertyArtwork, artwork);
            }
            center.setNowPlayingInfo(Some(&info));
        }
    }

    pub fn clear_info() {
        unsafe { MPNowPlayingInfoCenter::defaultCenter().setNowPlayingInfo(None) };
    }
}

pub(crate) fn register_listener(listeners: &Listeners, event: String, handler: Channel<Value>) {
    listeners
        .lock()
        .unwrap()
        .entry(event)
        .or_default()
        .push(handler);
}

pub(crate) fn remove_listener(listeners: &Listeners, event: &str, channel_id: u32) {
    if let Some(channels) = listeners.lock().unwrap().get_mut(event) {
        channels.retain(|c| c.id() != channel_id);
    }
}
