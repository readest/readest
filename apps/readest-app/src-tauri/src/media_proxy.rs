// Loopback HTTP proxy that streams Audiobookshelf tracks to the WebView's
// `<audio>` element through the app's own HTTP client (#6216).
//
// The ABS API client (tauri-plugin-http) accepts invalid certificates, so a
// self-hosted server behind a self-signed HTTPS reverse proxy connects and
// syncs. The WebView media element applies the platform's TLS trust instead:
// its track request died in the TLS handshake, the server logged the playback
// session but never a file request, and the player showed "Playback
// interrupted". A custom URI scheme can't bridge this - Android's WebView
// re-applies `Range` offsets to intercepted bodies (see range_file.rs) and
// scheme responses are buffered whole - so this is a real TCP listener on
// 127.0.0.1 that forwards `GET /<secret>/media?u=<track url>` upstream with
// the `Range` header intact and streams the body back.
//
// Security: loopback only; every request must carry the per-launch secret
// (only this WebView learns it, via `get_media_proxy_base`); targets are
// limited to http(s) URLs without credentials; the query, which carries the
// ABS access token, is never logged.

use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{
    ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, LAST_MODIFIED, RANGE,
};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tauri::Url;
use tokio::net::TcpListener;
use tokio::sync::OnceCell;

type ProxyBody = BoxBody<Bytes, std::io::Error>;

static PROXY_BASE: OnceCell<String> = OnceCell::const_new();

/// Base URL (`http://127.0.0.1:<port>/<secret>`) of the media proxy, started
/// on first use and kept for the life of the process.
#[tauri::command]
pub async fn get_media_proxy_base() -> Result<String, String> {
    PROXY_BASE
        .get_or_try_init(|| async { start(build_client()?).await })
        .await
        .cloned()
}

/// The same TLS policy as the ABS API client: self-signed and mismatched
/// certificates are accepted because the user explicitly pointed the app at
/// this server.
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("media proxy: client: {e}"))
}

/// Binds a fresh listener on 127.0.0.1 and serves it on the current tokio
/// runtime. Returns the base URL including the secret path segment.
async fn start(client: reqwest::Client) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("media proxy: bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("media proxy: local_addr: {e}"))?
        .port();
    let secret: Arc<str> = uuid::Uuid::new_v4().simple().to_string().into();
    let base = format!("http://127.0.0.1:{port}/{secret}");

    tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(e) => {
                    log::warn!("media proxy: accept failed: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let secret = secret.clone();
            let client = client.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| {
                    let secret = secret.clone();
                    let client = client.clone();
                    async move { Ok::<_, Infallible>(handle(req, &secret, &client).await) }
                });
                if let Err(e) = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await
                {
                    // The media element drops connections mid-body on every
                    // seek; that's normal, not worth a warning.
                    log::debug!("media proxy: connection closed: {e}");
                }
            });
        }
    });

    log::info!("media proxy: listening on 127.0.0.1:{port}");
    Ok(base)
}

async fn handle(
    req: Request<Incoming>,
    secret: &str,
    client: &reqwest::Client,
) -> Response<ProxyBody> {
    match forward(req, secret, client).await {
        Ok(response) => response,
        Err(status) => empty(status),
    }
}

fn empty(status: StatusCode) -> Response<ProxyBody> {
    Response::builder()
        .status(status)
        .body(BoxBody::new(
            Empty::<Bytes>::new().map_err(|never| match never {}),
        ))
        .unwrap()
}

/// Extracts and validates the `u=` target from the request query.
fn target_url(query: Option<&str>) -> Option<Url> {
    let raw = query?.split('&').find_map(|pair| pair.strip_prefix("u="))?;
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()?;
    let url = Url::parse(&decoded).ok()?;
    let ok = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none();
    ok.then_some(url)
}

async fn forward(
    req: Request<Incoming>,
    secret: &str,
    client: &reqwest::Client,
) -> Result<Response<ProxyBody>, StatusCode> {
    if req.method() != Method::GET {
        return Err(StatusCode::METHOD_NOT_ALLOWED);
    }
    if req.uri().path() != format!("/{secret}/media") {
        return Err(StatusCode::NOT_FOUND);
    }
    let target = target_url(req.uri().query()).ok_or(StatusCode::BAD_REQUEST)?;
    let host = target.host_str().unwrap_or_default().to_owned();

    let mut upstream = client.get(target.clone());
    if let Some(range) = req.headers().get(RANGE) {
        upstream = upstream.header(RANGE, range.clone());
    }
    let res = upstream.send().await.map_err(|e| {
        log::warn!("media proxy: {host} unreachable: {e}");
        StatusCode::BAD_GATEWAY
    })?;

    let status = res.status();
    if !status.is_success() {
        log::warn!(
            "media proxy: {host} answered {status} for {}",
            target.path()
        );
    }
    let mut builder = Response::builder().status(status);
    for name in [
        CONTENT_TYPE,
        CONTENT_LENGTH,
        CONTENT_RANGE,
        ACCEPT_RANGES,
        ETAG,
        LAST_MODIFIED,
    ] {
        if let Some(value) = res.headers().get(&name) {
            builder = builder.header(name, value.clone());
        }
    }
    let body = StreamBody::new(
        res.bytes_stream()
            .map(|chunk| chunk.map(Frame::data).map_err(std::io::Error::other)),
    );
    builder
        .body(BoxBody::new(body))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::Full;

    const TRACK_LEN: usize = 1000;
    const TOKEN: &str = "secret-token";

    fn track() -> Vec<u8> {
        (0..TRACK_LEN).map(|i| (i % 251) as u8).collect()
    }

    /// Stands in for ABS's `/api/items/:id/file/:ino`: a 1000-byte track that
    /// honours a single byte range like Express `sendFile`, and rejects a
    /// wrong `?token=` with 401 the way the real route does.
    async fn upstream(req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
        let authorized = req
            .uri()
            .query()
            .is_some_and(|q| q.split('&').any(|p| p == format!("token={TOKEN}")));
        if !authorized {
            return Ok(Response::builder()
                .status(401)
                .body(Full::new(Bytes::new()))
                .unwrap());
        }
        let bytes = track();
        let range = req
            .headers()
            .get(RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("bytes="))
            .and_then(|v| {
                let (start, end) = v.split_once('-')?;
                let start: usize = start.parse().ok()?;
                let end: usize = if end.is_empty() {
                    TRACK_LEN - 1
                } else {
                    end.parse().ok()?
                };
                Some((start, end))
            });
        let builder = Response::builder()
            .header(CONTENT_TYPE, "audio/mpeg")
            .header(ACCEPT_RANGES, "bytes");
        let response = match range {
            Some((start, end)) => builder
                .status(206)
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{TRACK_LEN}"))
                .header(CONTENT_LENGTH, (end + 1 - start).to_string())
                .body(Full::new(Bytes::copy_from_slice(&bytes[start..=end])))
                .unwrap(),
            None => builder
                .status(200)
                .header(CONTENT_LENGTH, TRACK_LEN.to_string())
                .body(Full::new(Bytes::from(bytes)))
                .unwrap(),
        };
        Ok(response)
    }

    /// Serves `upstream` on a fresh loopback port; returns the track URL.
    async fn spawn_upstream() -> String {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let _ = http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), service_fn(upstream))
                        .await;
                });
            }
        });
        format!("http://127.0.0.1:{port}/api/items/i1/file/2?token={TOKEN}")
    }

    /// A proxy on its own port (the process-wide cell would outlive this
    /// test's runtime), with a client that ignores the shell's proxy env.
    async fn spawn_proxy() -> String {
        start(test_client()).await.unwrap()
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    fn proxied(base: &str, target: &str) -> String {
        let encoded =
            percent_encoding::utf8_percent_encode(target, percent_encoding::NON_ALPHANUMERIC);
        format!("{base}/media?u={encoded}")
    }

    #[tokio::test]
    async fn streams_a_byte_range_with_the_upstream_headers() {
        let base = spawn_proxy().await;
        let track_url = spawn_upstream().await;

        let res = test_client()
            .get(proxied(&base, &track_url))
            .header(RANGE, "bytes=100-199")
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 206);
        assert_eq!(res.headers()[CONTENT_RANGE], "bytes 100-199/1000");
        assert_eq!(res.headers()[CONTENT_TYPE], "audio/mpeg");
        assert_eq!(res.headers()[ACCEPT_RANGES], "bytes");
        assert_eq!(res.bytes().await.unwrap().as_ref(), &track()[100..200]);
    }

    #[tokio::test]
    async fn serves_the_whole_track_without_a_range() {
        let base = spawn_proxy().await;
        let track_url = spawn_upstream().await;

        let res = test_client()
            .get(proxied(&base, &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[CONTENT_LENGTH], "1000");
        assert_eq!(res.bytes().await.unwrap().as_ref(), track().as_slice());
    }

    #[tokio::test]
    async fn passes_an_upstream_rejection_through() {
        let base = spawn_proxy().await;
        let stale = spawn_upstream().await.replace(TOKEN, "stale-token");

        let res = test_client()
            .get(proxied(&base, &stale))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 401);
    }

    #[tokio::test]
    async fn rejects_the_wrong_secret() {
        let base = spawn_proxy().await;
        let track_url = spawn_upstream().await;
        let (origin, _secret) = base.rsplit_once('/').unwrap();

        let res = test_client()
            .get(proxied(&format!("{origin}/guessed"), &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 404);
    }

    #[tokio::test]
    async fn rejects_a_missing_or_non_http_target() {
        let base = spawn_proxy().await;
        let client = test_client();

        for url in [
            format!("{base}/media"),
            proxied(&base, "file:///etc/passwd"),
            proxied(&base, "http://user:pw@127.0.0.1:1/x"),
            proxied(&base, "not a url"),
        ] {
            let res = client.get(&url).send().await.unwrap();
            assert_eq!(res.status(), 400, "{url}");
        }
    }

    #[tokio::test]
    async fn reports_an_unreachable_upstream_as_bad_gateway() {
        let base = spawn_proxy().await;

        let res = test_client()
            .get(proxied(&base, "http://127.0.0.1:1/api/items/i1/file/2"))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 502);
    }

    #[tokio::test]
    async fn only_serves_get() {
        let base = spawn_proxy().await;
        let track_url = spawn_upstream().await;

        let res = test_client()
            .post(proxied(&base, &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 405);
    }

    #[tokio::test]
    async fn the_base_is_loopback_with_a_fresh_secret_per_start() {
        let a = spawn_proxy().await;
        let b = spawn_proxy().await;

        assert!(a.starts_with("http://127.0.0.1:"), "{a}");
        let (_, secret) = a.rsplit_once('/').unwrap();
        assert_eq!(secret.len(), 32);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn target_url_accepts_only_http_targets() {
        let ok = target_url(Some(
            "u=https%3A%2F%2Fabs.example%2Fapi%2Fitems%2Fi1%2Ffile%2F2%3Ftoken%3Dt",
        ))
        .unwrap();
        assert_eq!(
            ok.as_str(),
            "https://abs.example/api/items/i1/file/2?token=t"
        );
        assert!(target_url(Some("u=http%3A%2F%2F192.168.2.3%3A13378%2Fa")).is_some());
        assert!(target_url(None).is_none());
        assert!(target_url(Some("x=1")).is_none());
        assert!(target_url(Some("u=ftp%3A%2F%2Fhost%2Fa")).is_none());
        assert!(target_url(Some("u=file%3A%2F%2F%2Fetc%2Fpasswd")).is_none());
        assert!(target_url(Some("u=http%3A%2F%2Fu%3Ap%40host%2Fa")).is_none());
    }
}
