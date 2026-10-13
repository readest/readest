//! Native GETs share the browser session without exposing cookies to the frontend.
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, COOKIE, LOCATION, SET_COOKIE};
use serde::Serialize;
use std::collections::HashMap;
#[cfg(mobile)]
use tauri::Manager;
use tauri::Url;

const MAX_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserResource {
    url: String,
    status: u16,
    content_type: String,
    body: String,
}

// Accept only HTTP(S), also on every redirect. No credentials embedded in URLs.
fn resource_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid URL".into());
    }
    // Reject explicit private destinations, including redirect targets. DNS and
    // proxy resolution are unchanged; this is not a DNS-rebinding defense.
    let host = url.host_str().unwrap_or_default();
    let host = host.trim_end_matches('.');
    let blocked = match host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
    {
        Ok(std::net::IpAddr::V4(ip)) => blocked_ipv4(ip),
        Ok(std::net::IpAddr::V6(ip)) => ip.to_ipv4().map(blocked_ipv4).unwrap_or_else(|| {
            let first = ip.segments()[0];
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || first & 0xfe00 == 0xfc00
                || first & 0xffc0 == 0xfe80
                || first & 0xffc0 == 0xfec0
        }),
        Err(_) => {
            !host.contains('.')
                || ["localhost", "local", "internal", "lan"]
                    .iter()
                    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        }
    };
    if blocked {
        return Err("Cannot import from a private network URL".into());
    }
    Ok(url)
}

fn blocked_ipv4(ip: std::net::Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_documentation()
        || a == 0
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (b == 18 || b == 19))
}

#[cfg(any(desktop, test))]
pub(crate) fn cookie_domain_matches(domain: &str, host: &str) -> bool {
    if domain.is_empty() {
        return false;
    }
    if let Some(domain) = domain.strip_prefix('.') {
        host == domain || host.ends_with(&format!(".{domain}"))
    } else {
        host == domain
    }
}

#[cfg(any(desktop, test))]
pub(crate) fn cookie_scope_matches(domain: &str, path: &str, secure: bool, url: &Url) -> bool {
    cookie_domain_matches(domain, url.host_str().unwrap_or_default())
        && (!secure || url.scheme() == "https")
        && (url.path() == path
            || (url.path().starts_with(path)
                && (path.ends_with('/') || url.path()[path.len()..].starts_with('/'))))
}

fn valid_response_cookie(header: &str, url: &Url) -> bool {
    let Ok(cookie) = tauri::webview::Cookie::parse(header) else {
        return false;
    };
    let Some(domain) = cookie.domain() else {
        return true;
    };
    let host = url.host_str().unwrap_or_default();
    psl::domain(domain.as_bytes()).is_some()
        && (host == domain || host.ends_with(&format!(".{domain}")))
}

#[cfg(any(target_os = "windows", test))]
fn preserve_windows_cookie_domain(cookie: &mut tauri::webview::Cookie<'_>) {
    // Wry passes Cookie::domain() to WebView2, but that getter strips one dot.
    // Keep a dot at the native boundary so explicit Domain cookies retain
    // subdomain scope. This in-memory adapter is never serialized as a header.
    if let Some(domain) = cookie.domain() {
        cookie.set_domain(format!("..{}", domain.trim_start_matches('.')));
    }
}

async fn browser_cookies<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    url: Url,
    set_cookies: Vec<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(mobile)]
        {
            use tauri_plugin_native_bridge::{NativeBridgeExt, WebBrowserCookiesRequest};
            webview
                .app_handle()
                .native_bridge()
                .web_browser_cookies(WebBrowserCookiesRequest {
                    url: url.to_string(),
                    set_cookies,
                })
                .map(|r| r.cookies)
                .map_err(|e| e.to_string())
        }
        #[cfg(target_os = "macos")]
        {
            crate::browser_cookies_macos::cookies(&webview, &url, set_cookies)
        }
        #[cfg(all(desktop, not(target_os = "macos")))]
        {
            for header in set_cookies {
                if let Ok(mut cookie) = tauri::webview::Cookie::parse(header) {
                    let host = url.host_str().unwrap_or_default();
                    if let Some(domain) = cookie.domain() {
                        let domain = domain.trim_start_matches('.');
                        if host != domain && !host.ends_with(&format!(".{domain}")) {
                            continue;
                        }
                        #[cfg(target_os = "windows")]
                        preserve_windows_cookie_domain(&mut cookie);
                    } else {
                        cookie.set_domain(host.to_string());
                    }
                    if cookie.path().is_none() {
                        let path = url
                            .path()
                            .rsplit_once('/')
                            .map(|(p, _)| p)
                            .filter(|p| !p.is_empty())
                            .unwrap_or("/");
                        cookie.set_path(path.to_string());
                    }
                    webview.set_cookie(cookie).map_err(|e| e.to_string())?;
                }
            }
            let cookies = webview
                .cookies_for_url(url.clone())
                .map_err(|e| e.to_string())?;
            Ok(cookies
                .iter()
                .filter(|c| {
                    cookie_scope_matches(
                        url.host_str().unwrap_or_default(),
                        c.path().unwrap_or("/"),
                        c.secure() == Some(true),
                        &url,
                    )
                })
                .map(|c| format!("{}={}", c.name(), c.value()))
                .collect::<Vec<_>>()
                .join("; "))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_web_browser_resource<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    url: String,
    headers: HashMap<String, String>,
) -> Result<BrowserResource, String> {
    let target = resource_url(&url)?;
    let mut request_headers = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| e.to_string())?;
        // Only browser-shaped request metadata. Never allow caller-provided credentials.
        if matches!(
            name.as_str(),
            "accept" | "accept-language" | "user-agent" | "referer" | "range"
        ) || name.as_str().starts_with("sec-")
        {
            request_headers.insert(
                name,
                HeaderValue::from_str(&value).map_err(|e| e.to_string())?,
            );
        }
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    fetch_resource(&client, target, request_headers, move |url, updated| {
        browser_cookies(webview.clone(), url, updated)
    })
    .await
}

async fn fetch_resource<F, Fut>(
    client: &reqwest::Client,
    mut target: Url,
    mut request_headers: HeaderMap,
    exchange: F,
) -> Result<BrowserResource, String>
where
    F: Fn(Url, Vec<String>) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        for _ in 0..10 {
            let cookies = exchange(target.clone(), vec![]).await?;
            let mut request = client.get(target.clone()).headers(request_headers.clone());
            if !cookies.is_empty() {
                request = request.header(COOKIE, cookies);
            }
            let mut response = request
                .send()
                .await
                .map_err(|e| e.without_url().to_string())?;
            let updated = response
                .headers()
                .get_all(SET_COOKIE)
                .iter()
                .filter_map(|v| v.to_str().ok())
                .filter(|value| valid_response_cookie(value, &target))
                .map(str::to_string)
                .collect::<Vec<_>>();
            if !updated.is_empty() {
                exchange(target.clone(), updated).await?;
            }
            if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or("Missing redirect URL")?;
                let next = resource_url(
                    target
                        .join(location)
                        .map_err(|_| "Invalid redirect URL")?
                        .as_str(),
                )?;
                if target.scheme() == "https" && next.scheme() != "https" {
                    return Err("Insecure redirect".into());
                }
                if next.origin() != target.origin() {
                    request_headers.remove("referer");
                }
                target = next;
                continue;
            }
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            if response
                .content_length()
                .is_some_and(|len| len > MAX_BYTES as u64)
            {
                return Err("Resource is too large".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| e.without_url().to_string())?
            {
                if bytes.len() + chunk.len() > MAX_BYTES {
                    return Err("Resource is too large".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(BrowserResource {
                url: target.to_string(),
                status,
                content_type,
                body: base64::engine::general_purpose::STANDARD.encode(bytes),
            });
        }
        Err("Too many redirects".into())
    })
    .await
    .map_err(|_| "Request timed out".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_cookie_renewal_preserves_domain_scope_at_the_wry_boundary() {
        for header in [
            "session=renewed; Domain=.example.org",
            "session=renewed; Domain=example.org",
        ] {
            let mut cookie = tauri::webview::Cookie::parse(header).unwrap();
            preserve_windows_cookie_domain(&mut cookie);
            // Wry passes domain() directly to WebView2 CreateCookie.
            assert_eq!(cookie.domain(), Some(".example.org"));
        }
        let mut host_only = tauri::webview::Cookie::parse("session=renewed; Path=/").unwrap();
        preserve_windows_cookie_domain(&mut host_only);
        assert_eq!(host_only.domain(), None);
        host_only.set_domain("www.example.org");
        assert_eq!(host_only.domain(), Some("www.example.org"));
    }

    #[test]
    fn disallows_non_http_and_embedded_credentials() {
        for url in [
            "file:///secret",
            "javascript:alert(1)",
            "https://user:pass@example.org/",
        ] {
            assert!(resource_url(url).is_err());
        }
        assert!(resource_url("https://example.org/chapter").is_ok());
    }
    #[test]
    fn disallows_explicit_private_network_targets() {
        for url in [
            "http://localhost/",
            "http://localhost./",
            "http://site.local/",
            "http://intranet/",
            "http://127.1/",
            "http://0x7f000001/",
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://100.64.0.1/",
            "http://198.18.0.1/",
            "http://224.0.0.1/",
            "http://240.0.0.1/",
            "http://[::]/",
            "http://[::1]/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
            "http://[ff02::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::127.0.0.1]/",
        ] {
            assert!(resource_url(url).is_err(), "accepted {url}");
        }
        for url in [
            "https://example.org/",
            "https://example.org./",
            "https://1.1.1.1/",
            "https://[2606:4700:4700::1111]/",
        ] {
            assert!(resource_url(url).is_ok(), "rejected {url}");
        }
    }

    #[test]
    fn response_cookies_cannot_write_other_sites_or_public_suffixes() {
        let url = Url::parse("https://www.example.co.uk/novel").unwrap();
        assert!(valid_response_cookie(
            "session=next; HttpOnly; Path=/",
            &url
        ));
        assert!(valid_response_cookie(
            "session=next; Domain=.example.co.uk",
            &url
        ));
        for cookie in [
            "session=bad; Domain=.co.uk",
            "session=bad; Domain=.uk",
            "session=bad; Domain=other.co.uk",
        ] {
            assert!(!valid_response_cookie(cookie, &url));
        }
    }

    #[tokio::test]
    async fn authenticated_get_renews_session_and_does_not_forward_it_on_redirect() {
        use std::sync::{Arc, Mutex};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for step in 0..3 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = vec![0; 4096];
                let count = stream.read(&mut bytes).await.unwrap();
                let request = String::from_utf8_lossy(&bytes[..count]).to_lowercase();
                let response = match step {
                    0 => {
                        assert!(request.contains("cookie: session=original"));
                        "HTTP/1.1 302 Found\r\nLocation: /renewed\r\nSet-Cookie: session=renewed; Path=/; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                    }
                    1 => {
                        assert!(request.contains("cookie: session=renewed"));
                        format!("HTTP/1.1 302 Found\r\nLocation: http://images.example.org:{port}/image\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    }
                    _ => {
                        assert!(!request.contains("cookie:"));
                        assert!(!request.contains("referer:"));
                        "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 5\r\nConnection: close\r\n\r\nimage".to_string()
                    }
                };
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let session = Arc::new(Mutex::new("session=original".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            "referer",
            HeaderValue::from_static("http://novels.example.org/private"),
        );
        let client = reqwest::Client::builder()
            .resolve("novels.example.org", ([127, 0, 0, 1], port).into())
            .resolve("images.example.org", ([127, 0, 0, 1], port).into())
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let result = fetch_resource(
            &client,
            Url::parse(&format!("http://novels.example.org:{port}/chapter")).unwrap(),
            headers,
            move |url, updated| {
                let session = session.clone();
                async move {
                    if url.host_str() != Some("novels.example.org") {
                        return Ok(String::new());
                    }
                    let mut session = session.lock().unwrap();
                    if let Some(cookie) = updated.first() {
                        *session = cookie.split(';').next().unwrap().to_string();
                    }
                    Ok(session.clone())
                }
            },
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(result.status, 200);
        assert_eq!(result.content_type, "image/png");
        assert_eq!(result.body, "aW1hZ2U=");
    }

    #[tokio::test]
    async fn rejects_redirects_to_private_network_targets() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            stream.read(&mut bytes).await.unwrap();
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let client = reqwest::Client::builder()
            .resolve("novels.example.org", address)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let result = fetch_resource(
            &client,
            resource_url(&format!(
                "http://novels.example.org:{}/chapter",
                address.port()
            ))
            .unwrap(),
            HeaderMap::new(),
            |_, _| async { Ok(String::new()) },
        )
        .await;
        server.await.unwrap();
        assert!(matches!(result, Err(message) if message.contains("private network")));
    }

    #[test]
    fn cookies_are_scoped_to_domain_path_and_transport() {
        for url in [
            "https://example.org/novel/1",
            "https://www.example.org/novel",
        ] {
            assert!(cookie_scope_matches(
                ".example.org",
                "/novel",
                true,
                &Url::parse(url).unwrap()
            ));
        }
        for url in [
            "https://other.org/novel",
            "https://example.org.evil.org/novel",
            "https://example.org/novella",
            "http://example.org/novel",
        ] {
            assert!(!cookie_scope_matches(
                ".example.org",
                "/novel",
                true,
                &Url::parse(url).unwrap()
            ));
        }
        assert!(!cookie_scope_matches(
            "example.org",
            "/",
            false,
            &Url::parse("https://sub.example.org/").unwrap()
        ));
        assert!(!cookie_scope_matches(
            "",
            "/",
            false,
            &Url::parse("https://example.org/").unwrap()
        ));
    }
}
