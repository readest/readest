//! The dialog plugin's `open` for Readest Lite. There is no native file dialog (no GTK, and on a
//! Kindle no desktop), so Readest's Import asks the page to draw one (`picker.js`) and waits for
//! its answer. Picked paths join the fs and asset scopes, as tauri-plugin-dialog's do.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime, State, Webview,
    async_runtime::{Sender, channel},
    plugin::{Builder, TauriPlugin},
};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct Pending {
    next: AtomicU32,
    answers: Mutex<HashMap<u32, Sender<Option<Vec<PathBuf>>>>>,
}

#[derive(Deserialize)]
struct Filter {
    extensions: Vec<String>,
}

#[derive(Deserialize)]
struct OpenOptions {
    #[serde(default)]
    multiple: bool,
    #[serde(default)]
    directory: bool,
    #[serde(default)]
    filters: Vec<Filter>,
    title: Option<String>,
}

#[tauri::command]
async fn open<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    pending: State<'_, Pending>,
    options: OpenOptions,
) -> Result<serde_json::Value, String> {
    let id = pending.next.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = channel(1);
    pending.answers.lock().unwrap().insert(id, tx);
    // READEST_LITE_DOCUMENTS: where the picker starts (the launcher sets the Kindle's documents)
    let start = std::env::var_os("READEST_LITE_DOCUMENTS")
        .map(PathBuf::from)
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| "/".into());
    let extensions: Vec<String> = options
        .filters
        .iter()
        .flat_map(|f| f.extensions.iter().map(|e| e.to_lowercase()))
        .filter(|e| e != "*")
        .collect();
    let request = serde_json::json!({
        "start": start,
        "extensions": extensions,
        "multiple": options.multiple,
        "directory": options.directory,
        "title": options.title,
    });
    webview
        .eval(format!("window.__litePicker.open({id}, {request})"))
        .map_err(|e| e.to_string())?;
    let Some(paths) = rx.recv().await.flatten() else {
        return Ok(serde_json::Value::Null);
    };
    for path in &paths {
        if options.directory {
            let _ = app.fs_scope().allow_directory(path, true);
            let _ = app.asset_protocol_scope().allow_directory(path, true);
        } else {
            let _ = app.fs_scope().allow_file(path);
            let _ = app.asset_protocol_scope().allow_file(path);
        }
    }
    Ok(if options.multiple {
        serde_json::json!(paths)
    } else {
        serde_json::json!(paths.first())
    })
}

/// The page's answer to `open` `id`: the chosen paths, or none when cancelled.
#[tauri::command]
fn pick(pending: State<'_, Pending>, id: u32, paths: Option<Vec<PathBuf>>) {
    if let Some(tx) = pending.answers.lock().unwrap().remove(&id) {
        let _ = tx.try_send(paths);
    }
}

#[derive(Serialize, Debug, PartialEq, Clone)]
struct Entry {
    name: String,
    dir: bool,
}

/// A folder's sub-folders, then its files with one of `extensions` (any when empty; none when
/// picking a folder), each sorted by name. Hidden entries and KOReader's `.sdr` folders (a book's
/// settings, kept beside it on e-readers) are left out.
#[tauri::command]
fn list_dir(path: PathBuf, extensions: Vec<String>, directory: bool) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let name = e.file_name().to_string_lossy().into_owned();
        let dir = e.path().is_dir();
        let skip = if dir {
            name.ends_with(".sdr")
        } else {
            directory || !has_extension(&name, &extensions)
        };
        if name.starts_with('.') || skip {
            continue;
        }
        entries.push(Entry { name, dir });
    }
    entries.sort_by_key(|e| (!e.dir, e.name.to_lowercase()));
    Ok(entries)
}

fn has_extension(name: &str, extensions: &[String]) -> bool {
    extensions.is_empty()
        || Path::new(name)
            .extension()
            .is_some_and(|x| extensions.contains(&x.to_string_lossy().to_lowercase()))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("dialog")
        .invoke_handler(tauri::generate_handler![open, pick, list_dir])
        .setup(|app, _| {
            app.manage(Pending::default());
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::{Entry, list_dir};

    #[test]
    fn a_listing_has_folders_then_matching_books() {
        let dir = std::env::temp_dir().join(format!("lite-picker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for d in ["b-folder", "A-folder", ".hidden", "x.sdr"] {
            std::fs::create_dir_all(dir.join(d)).unwrap();
        }
        for f in ["z.epub", "Alice.EPUB", "notes.txt", ".dot.epub", "c.pdf"] {
            std::fs::write(dir.join(f), b"").unwrap();
        }
        let names = |exts: &[&str], directory| {
            let exts = exts.iter().map(|e| e.to_string()).collect();
            list_dir(dir.clone(), exts, directory).unwrap()
        };
        let entry = |name: &str, dir| Entry {
            name: name.into(),
            dir,
        };
        // KOReader's `.sdr` folders (a book's settings, kept beside it) hold no books
        let folders = vec![entry("A-folder", true), entry("b-folder", true)];
        let mut books = folders.clone();
        books.extend([
            entry("Alice.EPUB", false),
            entry("c.pdf", false),
            entry("z.epub", false),
        ]);
        assert_eq!(names(&["epub", "pdf"], false), books);
        assert_eq!(names(&["epub", "pdf"], true), folders);
        assert_eq!(names(&[], false).len(), 6);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
