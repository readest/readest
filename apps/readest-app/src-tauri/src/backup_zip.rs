//! Bulk zip I/O for Backup & Restore.
//!
//! The JS side still plans the archive (which entries, their names, the
//! merged JSON), but every byte used to cross the Tauri IPC bridge. On
//! Android a request body is a JSON number array, which measured 3.9 MB/s
//! on a Xiaomi 13: a 687 MB library took three minutes to back up, and a
//! restore pays the same per file (#6291). Here the book bytes never leave
//! Rust; only entry names and paths cross the bridge.

use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use tauri::{ipc::Channel, AppHandle, Runtime};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::transfer_file::ensure_path_allowed;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// Zip entry name, forward slashes. Without `content` it is also the
    /// file's path relative to `src_dir` (books are stored verbatim).
    pub name: String,
    /// Inline UTF-8 content (library.json, settings.json), deflated.
    #[serde(default)]
    pub content: Option<String>,
}

/// Zip entry names are attacker-controlled (they come from the archive), so a
/// destination is only ever `dest_dir` joined with a plain relative name.
fn validate_entry_name(name: &str) -> Result<(), String> {
    let plain = !name.is_empty()
        && !name.contains('\\')
        && Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if plain {
        Ok(())
    } else {
        Err(format!("invalid zip entry name: {name}"))
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipProgress {
    pub current: usize,
    pub total: usize,
    pub name: String,
}

/// Opens a plain path or `file://` URL (both scope-checked; the picker grants
/// its picks to the fs scope) or an Android `content://` document, which only
/// the system picker can hand out. The original `FilePath` goes to the fs
/// plugin so an iOS security-scoped URL keeps working.
fn open_location<R: Runtime>(
    app: &AppHandle<R>,
    location: &str,
    opts: OpenOptions,
) -> Result<File, String> {
    let file_path = FilePath::from_str(location).map_err(|e| e.to_string())?;
    match &file_path {
        FilePath::Path(path) => {
            ensure_path_allowed(app, &path.to_string_lossy()).map_err(|e| e.to_string())?;
        }
        FilePath::Url(url) if url.scheme() == "file" => {
            let path = url
                .to_file_path()
                .map_err(|_| format!("invalid file URL: {location}"))?;
            ensure_path_allowed(app, &path.to_string_lossy()).map_err(|e| e.to_string())?;
        }
        FilePath::Url(url) if url.scheme() == "content" => {}
        FilePath::Url(url) => return Err(format!("unsupported location scheme: {}", url.scheme())),
    }
    app.fs()
        .open(file_path, opts)
        .map_err(|e| format!("failed to open {location}: {e}"))
}

/// `Fs::open` starts security-scoped access on an iOS picker URL; hand it back.
fn release_location<R: Runtime>(app: &AppHandle<R>, location: &str) {
    #[cfg(target_os = "ios")]
    if let Ok(file_path @ FilePath::Url(_)) = FilePath::from_str(location) {
        let _ = app.fs().stop_accessing_security_scoped_resource(file_path);
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, location);
}

#[tauri::command]
pub async fn write_backup_zip<R: Runtime>(
    app: AppHandle<R>,
    dest: String,
    src_dir: String,
    entries: Vec<BackupEntry>,
    on_progress: Channel<ZipProgress>,
) -> Result<(), String> {
    ensure_path_allowed(&app, &src_dir).map_err(|e| e.to_string())?;
    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    let out = open_location(&app, &dest, opts)?;
    let src_dir = PathBuf::from(src_dir);
    let result = tauri::async_runtime::spawn_blocking(move || {
        write_entries(out, &src_dir, &entries, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"));
    release_location(&app, &dest);
    result?
}

#[tauri::command]
pub async fn extract_backup_zip<R: Runtime>(
    app: AppHandle<R>,
    src: String,
    dest_dir: String,
    entries: Vec<String>,
    on_progress: Channel<ZipProgress>,
) -> Result<(), String> {
    ensure_path_allowed(&app, &dest_dir).map_err(|e| e.to_string())?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    let archive = open_location(&app, &src, opts)?;
    let dest_dir = PathBuf::from(dest_dir);
    let result = tauri::async_runtime::spawn_blocking(move || {
        extract_entries(archive, &dest_dir, &entries, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"));
    release_location(&app, &src);
    result?
}

fn write_entries<W: Write + Seek>(
    out: W,
    src_dir: &Path,
    entries: &[BackupEntry],
    mut on_progress: impl FnMut(ZipProgress),
) -> Result<(), String> {
    for entry in entries.iter().filter(|e| e.content.is_none()) {
        validate_entry_name(&entry.name)?;
    }
    let mut zip = ZipWriter::new(BufWriter::new(out));
    let total = entries.len();
    let mut files = 0usize;
    let mut skipped = 0usize;
    for (i, entry) in entries.iter().enumerate() {
        on_progress(ZipProgress {
            current: i + 1,
            total,
            name: entry.name.clone(),
        });
        if let Some(content) = &entry.content {
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            zip.start_file(&entry.name, options)
                .map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes())
                .map_err(|e| e.to_string())?;
            continue;
        }
        files += 1;
        let mut src = match File::open(src_dir.join(&entry.name)) {
            Ok(file) => file,
            Err(err) => {
                // Same as the JS writer: an unreadable file is skipped,
                // the rest of the library still gets backed up.
                log::warn!("Skipping backup entry {}: {err}", entry.name);
                skipped += 1;
                continue;
            }
        };
        let len = src.metadata().map(|m| m.len()).unwrap_or(0);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(len >= u64::from(u32::MAX));
        zip.start_file(&entry.name, options)
            .map_err(|e| e.to_string())?;
        io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
    }
    // Every book unreadable means the source dir is wrong, not the books:
    // a "completed" backup with no books in it would be silent data loss.
    if files > 0 && skipped == files {
        return Err(format!(
            "none of the {files} book files under {} could be read",
            src_dir.display()
        ));
    }
    zip.finish()
        .map_err(|e| e.to_string())?
        .flush()
        .map_err(|e| e.to_string())
}

fn extract_entries<R: Read + Seek>(
    archive: R,
    dest_dir: &Path,
    entries: &[String],
    mut on_progress: impl FnMut(ZipProgress),
) -> Result<(), String> {
    for name in entries {
        validate_entry_name(name)?;
    }
    let mut archive = ZipArchive::new(BufReader::new(archive)).map_err(|e| e.to_string())?;
    let total = entries.len();
    for (i, name) in entries.iter().enumerate() {
        on_progress(ZipProgress {
            current: i + 1,
            total,
            name: name.clone(),
        });
        let mut file = archive.by_name(name).map_err(|e| format!("{name}: {e}"))?;
        let dest = dest_dir.join(name);
        let parent = dest
            .parent()
            .ok_or_else(|| format!("{name}: no parent dir"))?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        // A symlink already under the destination must not lead the write
        // out of it: resolve the parent and require it to stay inside.
        let canonical_dir = dest_dir.canonicalize().map_err(|e| e.to_string())?;
        let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_parent.starts_with(&canonical_dir) {
            return Err(format!(
                "{name}: destination escapes {}",
                dest_dir.display()
            ));
        }
        // Land the bytes next to the target and rename on success, so a
        // corrupt entry cannot truncate the book the user already has.
        // `create_new` refuses to follow a symlink left in the temp's place.
        let tmp = PathBuf::from(format!("{}.part", dest.display()));
        let _ = std::fs::remove_file(&tmp);
        let mut out = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| format!("{}: {e}", tmp.display()))?;
        let copied = io::copy(&mut file, &mut out).map_err(|e| format!("{name}: {e}"));
        drop(out);
        if let Err(err) = copied {
            let _ = std::fs::remove_file(&tmp);
            return Err(err);
        }
        std::fs::rename(&tmp, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("readest-backup-zip-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file_entry(name: &str) -> BackupEntry {
        BackupEntry {
            name: name.into(),
            content: None,
        }
    }

    #[test]
    fn round_trips_stored_files_and_inline_text() {
        let src = temp_dir("src");
        let big: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::create_dir_all(src.join("h")).unwrap();
        std::fs::write(src.join("h/book.epub"), &big).unwrap();
        std::fs::write(src.join("h/cover.png"), b"png").unwrap();
        let entries = vec![
            BackupEntry {
                name: "library.json".into(),
                content: Some("[{\"hash\":\"h\"}]".into()),
            },
            file_entry("h/book.epub"),
            file_entry("h/cover.png"),
            file_entry("h/missing.bin"),
        ];

        let mut progress = Vec::new();
        let mut cursor = Cursor::new(Vec::new());
        write_entries(&mut cursor, &src, &entries, |p| {
            progress.push((p.current, p.total, p.name))
        })
        .unwrap();
        assert_eq!(progress.len(), 4);
        assert_eq!(progress[0], (1, 4, "library.json".to_string()));
        assert_eq!(progress[3], (4, 4, "h/missing.bin".to_string()));
        let bytes = cursor.into_inner();

        let mut archive = ZipArchive::new(Cursor::new(bytes.clone())).unwrap();
        assert_eq!(
            archive.len(),
            3,
            "an unreadable source file is skipped, not fatal"
        );
        assert_eq!(
            archive.by_name("h/book.epub").unwrap().compression(),
            CompressionMethod::Stored
        );
        assert_eq!(
            archive.by_name("library.json").unwrap().compression(),
            CompressionMethod::Deflated
        );
        let mut text = String::new();
        archive
            .by_name("library.json")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "[{\"hash\":\"h\"}]");

        let dest = temp_dir("dest");
        let extract = vec!["h/book.epub".to_string(), "h/cover.png".to_string()];
        let mut progress = Vec::new();
        extract_entries(Cursor::new(bytes), &dest, &extract, |p| {
            progress.push(p.current)
        })
        .unwrap();
        assert_eq!(progress, vec![1, 2]);
        assert_eq!(std::fs::read(dest.join("h/book.epub")).unwrap(), big);
        assert_eq!(std::fs::read(dest.join("h/cover.png")).unwrap(), b"png");
        assert!(
            !dest.join("h/book.epub.part").exists(),
            "the temp file is renamed onto the target"
        );

        let _ = std::fs::remove_dir_all(src);
        let _ = std::fs::remove_dir_all(dest);
    }

    #[test]
    fn extract_names_a_missing_entry() {
        let mut cursor = Cursor::new(Vec::new());
        let entries = [BackupEntry {
            name: "library.json".into(),
            content: Some("[]".into()),
        }];
        write_entries(&mut cursor, Path::new("/nonexistent"), &entries, |_| {}).unwrap();
        let dest = temp_dir("missing");
        let extract = ["nope/book.epub".to_string()];
        let err =
            extract_entries(Cursor::new(cursor.into_inner()), &dest, &extract, |_| {}).unwrap_err();
        assert!(err.contains("nope/book.epub"), "{err}");
    }

    #[test]
    fn extract_rejects_names_that_escape_the_destination() {
        for name in ["../x", "h/../../x", "/etc/x", "h\\..\\x", ""] {
            let mut cursor = Cursor::new(Vec::new());
            write_entries(&mut cursor, Path::new("/nonexistent"), &[], |_| {}).unwrap();
            let err = extract_entries(
                Cursor::new(cursor.into_inner()),
                Path::new("/tmp/never-written"),
                &[name.to_string()],
                |_| {},
            )
            .unwrap_err();
            assert!(err.contains("invalid zip entry name"), "{name}: {err}");
        }
    }

    #[test]
    fn write_fails_when_no_book_file_could_be_read() {
        let entries = [
            BackupEntry {
                name: "library.json".into(),
                content: Some("[]".into()),
            },
            file_entry("h/book.epub"),
            file_entry("h/cover.png"),
        ];
        let mut cursor = Cursor::new(Vec::new());
        let err =
            write_entries(&mut cursor, Path::new("/nonexistent"), &entries, |_| {}).unwrap_err();
        assert!(err.contains("none of the 2 book files"), "{err}");
    }

    #[test]
    fn write_rejects_names_that_escape_the_source() {
        let mut cursor = Cursor::new(Vec::new());
        let err = write_entries(
            &mut cursor,
            Path::new("/tmp"),
            &[file_entry("../etc/passwd")],
            |_| {},
        )
        .unwrap_err();
        assert!(err.contains("invalid zip entry name"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn extract_refuses_a_symlinked_directory_inside_the_destination() {
        let outside = temp_dir("outside");
        let dest = temp_dir("dest-symlink");
        std::os::unix::fs::symlink(&outside, dest.join("h")).unwrap();
        let src = temp_dir("src-symlink");
        std::fs::create_dir_all(src.join("h")).unwrap();
        std::fs::write(src.join("h/book.epub"), b"book").unwrap();
        let mut cursor = Cursor::new(Vec::new());
        write_entries(&mut cursor, &src, &[file_entry("h/book.epub")], |_| {}).unwrap();

        let err = extract_entries(
            Cursor::new(cursor.into_inner()),
            &dest,
            &["h/book.epub".to_string()],
            |_| {},
        )
        .unwrap_err();
        assert!(err.contains("escapes"), "{err}");
        assert!(!outside.join("book.epub").exists());
        assert!(!outside.join("book.epub.part").exists());
        let _ = std::fs::remove_dir_all(outside);
        let _ = std::fs::remove_dir_all(dest);
        let _ = std::fs::remove_dir_all(src);
    }
}
