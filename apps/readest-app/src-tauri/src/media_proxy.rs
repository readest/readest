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
// (only this WebView learns it, via `get_media_proxy_base`); the destination
// must be an http(s) URL without credentials AND its origin must be one of the
// configured Audiobookshelf servers (the secret authenticates the caller, the
// allowlist authorizes the destination - so a leaked secret cannot turn the
// proxy into an open SSRF relay onto loopback/LAN services, CWE-918);
// redirects are disabled so a hostile server cannot bounce a request past the
// allowlist. The query, which carries the ABS access token, is never logged.

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
use std::collections::HashSet;
use std::convert::Infallible;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::Url;
use tokio::net::TcpListener;
use tokio::sync::OnceCell;

type ProxyBody = BoxBody<Bytes, std::io::Error>;

// How long to wait for the upstream to send response HEADERS. `connect_timeout`
// on the client bounds only the TCP/TLS handshake; an upstream that completes
// it then withholds headers would otherwise park `send()` (and the WebView
// request) forever. The response BODY is never timed out - a long track stream
// is expected.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);

/// The set of upstream origins (`scheme://host:port`) the proxy is allowed to
/// reach, shared between the command (which extends it) and every connection
/// (which reads it). Grows as servers are added mid-session; never shrinks,
/// which is harmless - a removed server's token stops working anyway.
type Origins = Arc<RwLock<HashSet<String>>>;

struct Proxy {
    base: String,
    origins: Origins,
}

static PROXY: OnceCell<Proxy> = OnceCell::const_new();

/// Base URL (`http://127.0.0.1:<port>/<secret>`) of the media proxy, started
/// on first use and kept for the life of the process. `origins` are the
/// configured Audiobookshelf server origins the caller may stream from; they
/// are merged into the allowlist on every call so a server added mid-session
/// is reachable without restarting the proxy.
#[tauri::command]
pub async fn get_media_proxy_base(origins: Vec<String>) -> Result<String, String> {
    let proxy = PROXY
        .get_or_try_init(|| async {
            let origins: Origins = Arc::new(RwLock::new(HashSet::new()));
            let base = start(build_client()?, origins.clone()).await?;
            Ok::<_, String>(Proxy { base, origins })
        })
        .await?;
    if let Ok(mut allow) = proxy.origins.write() {
        allow.extend(origins);
    }
    Ok(proxy.base.clone())
}

/// The same TLS policy as the ABS API client: self-signed and mismatched
/// certificates are accepted because the user explicitly pointed the app at
/// this server. Redirects are disabled so a response cannot bounce the request
/// to an origin outside the allowlist; a connect timeout keeps a blackholed
/// upstream from parking the proxy task (and the WebView request) forever.
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("media proxy: client: {e}"))
}

/// Binds a fresh listener on 127.0.0.1 and serves it on the current tokio
/// runtime. Returns the base URL including the secret path segment.
async fn start(client: reqwest::Client, origins: Origins) -> Result<String, String> {
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
            let origins = origins.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| {
                    let secret = secret.clone();
                    let client = client.clone();
                    let origins = origins.clone();
                    async move { Ok::<_, Infallible>(handle(req, &secret, &client, &origins).await) }
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
    origins: &Origins,
) -> Response<ProxyBody> {
    match forward(req, secret, client, origins).await {
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

/// Extracts and validates the `u=` target from the request query. Enforces the
/// http(s)-with-no-credentials shape; the origin allowlist is checked
/// separately (it needs the shared state).
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

/// Whether `url`'s origin (`scheme://host:port`) is one the proxy may reach.
/// The UUID secret authenticates the caller; this authorizes the destination.
fn origin_allowed(url: &Url, origins: &RwLock<HashSet<String>>) -> bool {
    match origins.read() {
        Ok(allow) => allow.contains(&url.origin().ascii_serialization()),
        Err(_) => false,
    }
}

/// Send the request, bounding only the wait for response HEADERS: a 504 when
/// the upstream withholds them past `timeout`, a 502 when the connection
/// itself fails. The returned response's body is left unbounded on purpose.
async fn send_with_timeout(
    request: reqwest::RequestBuilder,
    timeout: Duration,
    host: &str,
) -> Result<reqwest::Response, StatusCode> {
    match tokio::time::timeout(timeout, request.send()).await {
        Err(_) => {
            log::warn!("media proxy: {host} withheld response headers past {timeout:?}");
            Err(StatusCode::GATEWAY_TIMEOUT)
        }
        Ok(Err(e)) => {
            log::warn!("media proxy: {host} unreachable: {e}");
            Err(StatusCode::BAD_GATEWAY)
        }
        Ok(Ok(res)) => Ok(res),
    }
}

async fn forward(
    req: Request<Incoming>,
    secret: &str,
    client: &reqwest::Client,
    origins: &Origins,
) -> Result<Response<ProxyBody>, StatusCode> {
    if req.method() != Method::GET {
        return Err(StatusCode::METHOD_NOT_ALLOWED);
    }
    if req.uri().path() != format!("/{secret}/media") {
        return Err(StatusCode::NOT_FOUND);
    }
    let target = target_url(req.uri().query()).ok_or(StatusCode::BAD_REQUEST)?;
    if !origin_allowed(&target, origins) {
        log::warn!(
            "media proxy: refused an off-allowlist origin: {}",
            target.origin().ascii_serialization()
        );
        return Err(StatusCode::FORBIDDEN);
    }
    let host = target.host_str().unwrap_or_default().to_owned();

    let mut upstream = client.get(target.clone());
    if let Some(range) = req.headers().get(RANGE) {
        upstream = upstream.header(RANGE, range.clone());
    }
    let res = send_with_timeout(upstream, HEADER_TIMEOUT, &host).await?;

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

    /// Accepts a connection then holds it open without ever sending a response
    /// - an upstream that completed the handshake but withholds headers.
    async fn spawn_hanging_upstream() -> String {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let _held = stream;
                    tokio::time::sleep(Duration::from_secs(60)).await;
                });
            }
        });
        format!("http://127.0.0.1:{port}/api/items/i1/file/2?token={TOKEN}")
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

    fn origin_of(url: &str) -> String {
        Url::parse(url).unwrap().origin().ascii_serialization()
    }

    /// A proxy on its own port (the process-wide cell would outlive this
    /// test's runtime), allowing exactly the given origins, with a client that
    /// ignores the shell's proxy env.
    async fn spawn_proxy(allow: &[String]) -> String {
        let origins: Origins = Arc::new(RwLock::new(allow.iter().cloned().collect()));
        start(test_client(), origins).await.unwrap()
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    fn proxied(base: &str, target: &str) -> String {
        let encoded =
            percent_encoding::utf8_percent_encode(target, percent_encoding::NON_ALPHANUMERIC);
        format!("{base}/media?u={encoded}")
    }

    #[tokio::test]
    async fn streams_a_byte_range_with_the_upstream_headers() {
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&[origin_of(&track_url)]).await;

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
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&[origin_of(&track_url)]).await;

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
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&[origin_of(&track_url)]).await;
        let stale = track_url.replace(TOKEN, "stale-token");

        let res = test_client()
            .get(proxied(&base, &stale))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 401);
    }

    #[tokio::test]
    async fn rejects_the_wrong_secret() {
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&[origin_of(&track_url)]).await;
        let (origin, _secret) = base.rsplit_once('/').unwrap();

        let res = test_client()
            .get(proxied(&format!("{origin}/guessed"), &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 404);
    }

    #[tokio::test]
    async fn rejects_a_target_outside_the_allowlist() {
        // The caller has the secret (right path) but aims at an origin no
        // configured server owns: the SSRF the allowlist exists to stop.
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&["http://someone-else.invalid".into()]).await;

        let res = test_client()
            .get(proxied(&base, &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 403);
    }

    #[tokio::test]
    async fn rejects_a_missing_or_non_http_target() {
        let base = spawn_proxy(&[]).await;
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
    async fn times_out_when_the_upstream_withholds_headers() {
        // Uses a short timeout so the test is fast; forward() uses HEADER_TIMEOUT.
        let url = spawn_hanging_upstream().await;

        let err = send_with_timeout(test_client().get(&url), Duration::from_millis(300), "h")
            .await
            .unwrap_err();

        assert_eq!(err, StatusCode::GATEWAY_TIMEOUT);
    }

    #[tokio::test]
    async fn reports_an_unreachable_upstream_as_bad_gateway() {
        let base = spawn_proxy(&["http://127.0.0.1:1".into()]).await;

        let res = test_client()
            .get(proxied(&base, "http://127.0.0.1:1/api/items/i1/file/2"))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 502);
    }

    #[tokio::test]
    async fn only_serves_get() {
        let track_url = spawn_upstream().await;
        let base = spawn_proxy(&[origin_of(&track_url)]).await;

        let res = test_client()
            .post(proxied(&base, &track_url))
            .send()
            .await
            .unwrap();

        assert_eq!(res.status(), 405);
    }

    #[tokio::test]
    async fn the_base_is_loopback_with_a_fresh_secret_per_start() {
        let a = spawn_proxy(&[]).await;
        let b = spawn_proxy(&[]).await;

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

    #[test]
    fn origin_allowed_matches_scheme_host_and_port() {
        let allow: RwLock<HashSet<String>> =
            RwLock::new(HashSet::from(["https://abs.example".to_string()]));
        let allowed = Url::parse("https://abs.example/api/items/i1/file/2?token=t").unwrap();
        let other_port = Url::parse("https://abs.example:8443/api/items/i1/file/2").unwrap();
        let other_host = Url::parse("https://evil.example/api/items/i1/file/2").unwrap();
        let other_scheme = Url::parse("http://abs.example/api/items/i1/file/2").unwrap();

        assert!(origin_allowed(&allowed, &allow));
        assert!(!origin_allowed(&other_port, &allow));
        assert!(!origin_allowed(&other_host, &allow));
        assert!(!origin_allowed(&other_scheme, &allow));
    }
}
