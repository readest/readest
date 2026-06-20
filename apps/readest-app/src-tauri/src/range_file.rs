// Custom `rangefile` URI scheme that serves byte ranges of local files to the
// WebView WITHOUT using a `Range` request header.
//
// Why this exists: on Android the WebView mishandles `Range` requests served
// through `shouldInterceptRequest` — it re-applies the range offset to the
// already-sliced intercepted body (skips `start` bytes a second time), so any
// non-zero-start range served by the asset protocol returns corrupt data or
// `net::ERR_FAILED` (Chromium 40739128; tauri-apps/tauri#12019, #3725). That
// makes `RemoteFile`'s random-access reads unusable through the asset protocol
// on Android.
//
// This scheme sidesteps the bug by encoding the range in the URL query
// (`?path=..&start=..&end=..`) instead of a `Range` header. With no `Range`
// header present the WebView performs no offset re-application and delivers the
// 200 body verbatim, while the bytes still stream through the WebView network
// stack (not the slow Tauri IPC bridge). Security mirrors the asset protocol:
// only paths allowed by `asset_protocol_scope` are served.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// Scheme name; the WebView reaches it at `http://rangefile.localhost/`.
pub const SCHEME: &str = "rangefile";

/// Upper bound on bytes returned for a single request. `RemoteFile` already
/// chunks its reads well below this; the cap just bounds a pathological range.
const MAX_RANGE_LEN: u64 = 8 * 1024 * 1024;

/// Parsed `?path=..&start=..&end=..` query. `end` is inclusive (matches
/// `RemoteFile.fetchRangePart`); omitted `end` means "to EOF".
struct RangeQuery {
    path: PathBuf,
    start: u64,
    end: Option<u64>,
}

fn parse_query(uri_query: Option<&str>) -> Option<RangeQuery> {
    let query = uri_query?;
    let mut path: Option<PathBuf> = None;
    let mut start: u64 = 0;
    let mut end: Option<u64> = None;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next().unwrap_or("");
        let val = it.next().unwrap_or("");
        match key {
            "path" => {
                let decoded = percent_encoding::percent_decode_str(val)
                    .decode_utf8_lossy()
                    .into_owned();
                if !decoded.is_empty() {
                    path = Some(PathBuf::from(decoded));
                }
            }
            "start" => start = val.parse().unwrap_or(0),
            "end" => end = val.parse().ok(),
            _ => {}
        }
    }
    Some(RangeQuery {
        path: path?,
        start,
        end,
    })
}

/// Defense-in-depth path guard, mirroring the asset protocol's `SafePathBuf`:
/// reject anything that isn't an absolute, traversal-free, NUL-free path BEFORE
/// the scope check. The scope's `is_allowed` already canonicalizes (resolving
/// `..`/symlinks) for existing files, so this is redundant for the security
/// outcome — but it fails closed and keeps the handler obviously-correct
/// instead of relying on that canonicalization subtlety.
fn is_safe_path(path: &Path) -> bool {
    path.is_absolute()
        && !path.to_string_lossy().contains('\0')
        && !path.components().any(|c| matches!(c, Component::ParentDir))
}

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    // The handler runs off the UI thread (Android `shouldInterceptRequest` is
    // called on a WebView worker thread), so blocking file I/O here is fine.
    responder.respond(build_response(ctx.app_handle(), &request));
}

fn cors_origin(request: &Request<Vec<u8>>) -> String {
    request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "*".to_string())
}

fn error(origin: &str, status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", origin)
        .header("Cache-Control", "no-store")
        .body(Vec::new())
        .unwrap()
}

fn build_response<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = cors_origin(request);

    let query = match parse_query(request.uri().query()) {
        Some(q) => q,
        None => return error(&origin, StatusCode::BAD_REQUEST),
    };

    // Defense-in-depth: reject traversal/NUL/relative paths outright.
    if !is_safe_path(&query.path) {
        log::warn!("rangefile: rejected unsafe path: {:?}", query.path);
        return error(&origin, StatusCode::FORBIDDEN);
    }

    // Security: identical boundary to the asset protocol — only paths the
    // importer/picker has granted are readable.
    if !app.asset_protocol_scope().is_allowed(&query.path) {
        log::warn!(
            "rangefile: path not allowed by asset scope: {:?}",
            query.path
        );
        return error(&origin, StatusCode::FORBIDDEN);
    }

    let mut file = match File::open(&query.path) {
        Ok(f) => f,
        Err(e) => {
            let status = match e.kind() {
                std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return error(&origin, status);
        }
    };

    let total = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return error(&origin, StatusCode::INTERNAL_SERVER_ERROR),
    };

    let start = query.start.min(total);
    let last = total.saturating_sub(1);
    let end_inclusive = query.end.unwrap_or(last).min(last);
    let nbytes = if total == 0 || start > end_inclusive {
        0
    } else {
        (end_inclusive + 1 - start).min(MAX_RANGE_LEN)
    };

    let mut buf = vec![0u8; nbytes as usize];
    if nbytes > 0 {
        if file.seek(SeekFrom::Start(start)).is_err() {
            return error(&origin, StatusCode::INTERNAL_SERVER_ERROR);
        }
        let mut filled = 0usize;
        while filled < buf.len() {
            match file.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(_) => return error(&origin, StatusCode::INTERNAL_SERVER_ERROR),
            }
        }
        buf.truncate(filled);
    }

    // 200 (not 206) and NO `Content-Range`: the range was carried in the URL,
    // not a `Range` header, so the WebView delivers this body verbatim.
    Response::builder()
        .status(StatusCode::OK)
        .header("Access-Control-Allow-Origin", origin)
        .header(
            "Access-Control-Expose-Headers",
            "X-Total-Size, Content-Length",
        )
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", buf.len().to_string())
        .header("X-Total-Size", total.to_string())
        .header("Cache-Control", "no-store")
        .body(buf)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_start_end() {
        let q = parse_query(Some("path=%2Fbooks%2Fa.epub&start=1024&end=2047")).unwrap();
        assert_eq!(q.path, PathBuf::from("/books/a.epub"));
        assert_eq!(q.start, 1024);
        assert_eq!(q.end, Some(2047));
    }

    #[test]
    fn decodes_utf8_path() {
        // encodeURIComponent("/书/堂吉诃德.mobi")
        let q = parse_query(Some(
            "path=%2F%E4%B9%A6%2F%E5%A0%82%E5%90%89%E8%AF%83%E5%BE%B7.mobi&start=0&end=0",
        ))
        .unwrap();
        assert_eq!(q.path, PathBuf::from("/书/堂吉诃德.mobi"));
    }

    #[test]
    fn missing_path_is_none() {
        assert!(parse_query(Some("start=0&end=10")).is_none());
        assert!(parse_query(None).is_none());
    }

    #[test]
    fn end_omitted_means_eof() {
        let q = parse_query(Some("path=%2Fa&start=5")).unwrap();
        assert_eq!(q.start, 5);
        assert_eq!(q.end, None);
    }

    #[test]
    fn ampersand_and_equals_in_path_are_percent_encoded() {
        // encodeURIComponent("/a&b=c.epub") -> %2Fa%26b%3Dc.epub
        let q = parse_query(Some("path=%2Fa%26b%3Dc.epub&start=0")).unwrap();
        assert_eq!(q.path, PathBuf::from("/a&b=c.epub"));
    }

    #[test]
    fn safe_path_accepts_absolute_traversal_free() {
        assert!(is_safe_path(Path::new(
            "/data/user/0/com.bilingify.readest/Readest/Books/a.epub"
        )));
        assert!(is_safe_path(Path::new("/书/堂吉诃德.mobi")));
    }

    #[test]
    fn safe_path_rejects_parent_dir_traversal() {
        assert!(!is_safe_path(Path::new(
            "/data/user/0/com.bilingify.readest/Readest/../../../../etc/passwd"
        )));
        assert!(!is_safe_path(Path::new("/a/../b")));
    }

    #[test]
    fn safe_path_rejects_relative_and_nul() {
        assert!(!is_safe_path(Path::new("data/x/a.epub"))); // not absolute
        assert!(!is_safe_path(Path::new("a.epub")));
        assert!(!is_safe_path(Path::new("/data/a\0b.epub"))); // NUL byte
    }
}
