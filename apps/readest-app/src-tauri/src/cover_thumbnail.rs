use crate::parser_common::{COVER_JPEG_QUALITY, COVER_MAX_LONG_EDGE, COVER_RESIZE_FILTER};
use crate::transfer_file::ensure_path_allowed;
use image::{codecs::jpeg::JpegEncoder, GenericImageView};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const COVER_THUMBNAIL_READY_EVENT: &str = "cover-thumbnail-ready";
const COVER_THUMBNAIL_CACHE_DIR: &str = "cover-thumbnails";
const COVER_THUMBNAIL_VERSION: &str = "v1";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverThumbnailRequest {
    book_hash: String,
    cover_hash: Option<String>,
}

#[derive(Clone, Debug)]
struct CoverJob {
    book_hash: String,
    cover_hash: Option<String>,
    source: PathBuf,
    destination: PathBuf,
}

impl CoverJob {
    fn key(&self) -> String {
        self.destination.to_string_lossy().into_owned()
    }
}

#[derive(Default)]
struct QueueState {
    pending: VecDeque<CoverJob>,
    queued: HashSet<String>,
    running: bool,
}

impl QueueState {
    /// Returns true only when the caller needs to start a worker.
    fn enqueue(&mut self, jobs: impl IntoIterator<Item = CoverJob>) -> bool {
        for job in jobs {
            if self.queued.insert(job.key()) {
                self.pending.push_back(job);
            }
        }
        if !self.running && !self.pending.is_empty() {
            self.running = true;
            true
        } else {
            false
        }
    }

    fn pop(&mut self) -> Option<CoverJob> {
        self.pending.pop_front()
    }

    fn finish(&mut self, job: &CoverJob) {
        self.queued.remove(&job.key());
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverThumbnailReadyPayload {
    book_hash: String,
    cover_hash: Option<String>,
    thumbnail_path: String,
}

static QUEUE: OnceLock<Mutex<QueueState>> = OnceLock::new();

fn queue() -> &'static Mutex<QueueState> {
    QUEUE.get_or_init(|| Mutex::new(QueueState::default()))
}

fn lock_queue() -> std::sync::MutexGuard<'static, QueueState> {
    queue()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn is_md5(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn build_jobs(
    books_dir: &Path,
    cache_dir: &Path,
    covers: Vec<CoverThumbnailRequest>,
) -> Vec<CoverJob> {
    covers
        .into_iter()
        .filter_map(|cover| {
            if !is_md5(&cover.book_hash) {
                log::warn!("Skipping cover with invalid book hash: {}", cover.book_hash);
                return None;
            }
            let cover_hash = match cover.cover_hash {
                Some(hash) if is_md5(&hash) => Some(hash),
                Some(hash) => {
                    log::warn!(
                        "Ignoring invalid cover hash for {}: {hash}",
                        cover.book_hash
                    );
                    None
                }
                None => None,
            };
            let cache_key = cover_hash.as_deref().unwrap_or("legacy");
            Some(CoverJob {
                source: books_dir.join(&cover.book_hash).join("cover.png"),
                destination: cache_dir
                    .join(COVER_THUMBNAIL_CACHE_DIR)
                    .join(COVER_THUMBNAIL_VERSION)
                    .join(format!("{}-{cache_key}.jpg", cover.book_hash)),
                book_hash: cover.book_hash,
                cover_hash,
            })
        })
        .collect()
}

/// Queue cover work and return immediately. All filesystem access and image
/// decoding happens on the detached blocking worker, never on the webview/UI
/// thread or in the command future.
#[tauri::command]
pub fn optimize_cover_thumbnails(
    app: AppHandle,
    books_dir: String,
    cache_dir: String,
    covers: Vec<CoverThumbnailRequest>,
) -> Result<(), String> {
    ensure_path_allowed(&app, &books_dir).map_err(|error| error.to_string())?;
    ensure_path_allowed(&app, &cache_dir).map_err(|error| error.to_string())?;

    let jobs = build_jobs(Path::new(&books_dir), Path::new(&cache_dir), covers);
    let should_start = lock_queue().enqueue(jobs);
    if should_start {
        tauri::async_runtime::spawn_blocking(move || run_worker(app));
    }
    Ok(())
}

fn run_worker(app: AppHandle) {
    loop {
        let job = {
            let mut state = lock_queue();
            match state.pop() {
                Some(job) => job,
                None => {
                    state.running = false;
                    return;
                }
            }
        };

        match create_or_reuse_thumbnail(&job) {
            Ok(path) => {
                let _ = app.emit(
                    COVER_THUMBNAIL_READY_EVENT,
                    CoverThumbnailReadyPayload {
                        book_hash: job.book_hash.clone(),
                        cover_hash: job.cover_hash.clone(),
                        thumbnail_path: path.to_string_lossy().into_owned(),
                    },
                );
            }
            Err(error) => {
                // Remove failed jobs from the in-process dedupe set. A later
                // visibility request can submit them again after interruption
                // or a transient read/decode/write failure.
                log::warn!("Cover thumbnail failed for {}: {error}", job.book_hash);
            }
        }

        lock_queue().finish(&job);
    }
}

fn create_or_reuse_thumbnail(job: &CoverJob) -> Result<PathBuf, String> {
    if fs::metadata(&job.destination)
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
    {
        return Ok(job.destination.clone());
    }

    let bytes = fs::read(&job.source).map_err(|error| format!("read failed: {error}"))?;
    let thumbnail = encode_thumbnail(&bytes)?;
    let parent = job
        .destination
        .parent()
        .ok_or_else(|| "thumbnail destination has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("create cache dir failed: {error}"))?;

    let temporary = job.destination.with_extension("jpg.tmp");
    fs::write(&temporary, thumbnail).map_err(|error| format!("write failed: {error}"))?;
    match fs::rename(&temporary, &job.destination) {
        Ok(()) => Ok(job.destination.clone()),
        Err(_) if job.destination.is_file() => {
            let _ = fs::remove_file(temporary);
            Ok(job.destination.clone())
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(format!("atomic rename failed: {error}"))
        }
    }
}

fn encode_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image =
        image::load_from_memory(bytes).map_err(|error| format!("decode failed: {error}"))?;
    let (width, height) = image.dimensions();
    let image = if width.max(height) > COVER_MAX_LONG_EDGE {
        image.resize(
            COVER_MAX_LONG_EDGE,
            COVER_MAX_LONG_EDGE,
            COVER_RESIZE_FILTER,
        )
    } else {
        image
    };
    let rgb = image.to_rgb8();
    let mut output = Vec::with_capacity(64 * 1024);
    JpegEncoder::new_with_quality(Cursor::new(&mut output), COVER_JPEG_QUALITY)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| format!("encode failed: {error}"))?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(name: &str) -> CoverJob {
        CoverJob {
            book_hash: name.repeat(32 / name.len()),
            cover_hash: None,
            source: PathBuf::from(format!("/books/{name}/cover.png")),
            destination: PathBuf::from(format!("/cache/{name}.jpg")),
        }
    }

    #[test]
    fn reentrant_enqueue_deduplicates_without_starting_a_second_worker() {
        let first = job("a");
        let second = job("b");
        let mut state = QueueState::default();

        assert!(state.enqueue([first.clone()]));
        assert!(!state.enqueue([first, second]));
        assert_eq!(state.pending.len(), 2);
        assert!(state.running);
    }

    #[test]
    fn finished_or_failed_job_can_be_retried() {
        let cover = job("a");
        let mut state = QueueState::default();

        assert!(state.enqueue([cover.clone()]));
        let active = state.pop().unwrap();
        state.finish(&active);
        state.running = false;

        assert!(state.enqueue([cover]));
        assert_eq!(state.pending.len(), 1);
    }

    #[test]
    fn jobs_are_versioned_and_content_addressed() {
        let book_hash = "a".repeat(32);
        let cover_hash = "b".repeat(32);
        let jobs = build_jobs(
            Path::new("/books"),
            Path::new("/cache"),
            vec![CoverThumbnailRequest {
                book_hash: book_hash.clone(),
                cover_hash: Some(cover_hash.clone()),
            }],
        );

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].cover_hash.as_deref(), Some(cover_hash.as_str()));
        assert_eq!(
            jobs[0].destination,
            PathBuf::from(format!(
                "/cache/cover-thumbnails/v1/{book_hash}-{cover_hash}.jpg"
            ))
        );
    }

    #[test]
    fn invalid_hashes_cannot_escape_the_cache_namespace() {
        let valid_book_hash = "a".repeat(32);
        let jobs = build_jobs(
            Path::new("/books"),
            Path::new("/cache"),
            vec![
                CoverThumbnailRequest {
                    book_hash: "../outside".to_string(),
                    cover_hash: None,
                },
                CoverThumbnailRequest {
                    book_hash: valid_book_hash.clone(),
                    cover_hash: Some("../outside".to_string()),
                },
            ],
        );

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].cover_hash, None);
        assert_eq!(
            jobs[0].destination,
            PathBuf::from(format!(
                "/cache/cover-thumbnails/v1/{valid_book_hash}-legacy.jpg"
            ))
        );
    }

    #[test]
    fn thumbnail_is_always_a_bounded_jpeg() {
        let source = image::DynamicImage::ImageRgb8(image::RgbImage::new(1200, 800));
        let mut png = Vec::new();
        source
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        let thumbnail = encode_thumbnail(&png).unwrap();
        assert_eq!(&thumbnail[..2], &[0xff, 0xd8]);
        let decoded = image::load_from_memory(&thumbnail).unwrap();
        let (width, height) = decoded.dimensions();
        assert_eq!(width.max(height), COVER_MAX_LONG_EDGE);
    }

    #[test]
    fn small_covers_are_reencoded_without_upscaling() {
        let source = image::DynamicImage::ImageRgba8(image::RgbaImage::new(240, 360));
        let mut png = Vec::new();
        source
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();

        let thumbnail = encode_thumbnail(&png).unwrap();
        assert_eq!(&thumbnail[..2], &[0xff, 0xd8]);
        assert_eq!(
            image::load_from_memory(&thumbnail).unwrap().dimensions(),
            (240, 360)
        );
    }

    #[test]
    fn corrupt_source_does_not_commit_a_cache_checkpoint() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "readest-corrupt-cover-thumbnail-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("books/cover.png");
        let destination = root.join("cache/cover.jpg");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"not an image").unwrap();
        let cover = CoverJob {
            book_hash: "a".repeat(32),
            cover_hash: None,
            source,
            destination: destination.clone(),
        };

        assert!(create_or_reuse_thumbnail(&cover)
            .unwrap_err()
            .starts_with("decode failed:"));
        assert!(!destination.exists());
        assert!(!destination.with_extension("jpg.tmp").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_write_is_retried_and_completed_cache_is_reused() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "readest-cover-thumbnail-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("books/cover.png");
        let destination = root.join("cache/cover.jpg");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::create_dir_all(destination.parent().unwrap()).unwrap();

        let image = image::DynamicImage::ImageRgb8(image::RgbImage::new(800, 1200));
        let mut png = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        fs::write(&source, png).unwrap();
        // Simulate termination between writing the temporary file and rename.
        fs::write(destination.with_extension("jpg.tmp"), b"partial").unwrap();

        let cover = CoverJob {
            book_hash: "a".repeat(32),
            cover_hash: None,
            source: source.clone(),
            destination: destination.clone(),
        };
        assert_eq!(create_or_reuse_thumbnail(&cover).unwrap(), destination);
        let cached = fs::read(&destination).unwrap();
        assert_eq!(&cached[..2], &[0xff, 0xd8]);

        // Once committed, the cache is a durable checkpoint: the original is
        // no longer needed to serve the next library load.
        fs::remove_file(source).unwrap();
        assert_eq!(create_or_reuse_thumbnail(&cover).unwrap(), destination);

        fs::remove_dir_all(root).unwrap();
    }
}
