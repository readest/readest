//! Lets Readest's own pages reach this machine and the LAN under CEF (#7521).
//!
//! Chromium asks before a page loads anything from a loopback or private
//! address (Local Network Access), unless the page came from one itself.
//! Release builds serve the app from `http://tauri.localhost` through a scheme
//! handler, which has no address, so the first request to the media proxy on
//! 127.0.0.1 waits behind "wants to access other apps and services on this
//! device". Block is remembered, and narration of an MP3 stored uncompressed
//! in an EPUB then stops without a word. Cover images from an OPDS server on
//! the LAN get the matching local-network prompt. Dev builds load
//! `http://localhost:3000`, which is loopback, so they never ask.
//!
//! Both permissions are granted to the app's own origin on every load, which
//! also undoes an earlier Block. The web browser and clipper windows load
//! third-party sites, and those keep Chromium's prompt.

use tauri::Url;

/// The host the CEF runtime serves the app from (its `custom_scheme_url`).
const APP_HOST: &str = "tauri.localhost";

/// The origin to grant when `url` is one of the app's own pages.
fn app_origin(url: &Url) -> Option<String> {
    let app_page = matches!(url.scheme(), "http" | "https") && url.host_str() == Some(APP_HOST);
    app_page.then(|| url.origin().ascii_serialization())
}

#[cfg(feature = "cef")]
pub fn allow_for_app_page(
    webview: &tauri::Webview<tauri_runtime_cef::CefRuntime>,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri_runtime_cef::cef::{
        CefString, ContentSettingTypes, ContentSettingValues, ImplBrowser, ImplBrowserHost,
        ImplRequestContext,
    };

    if payload.event() != tauri::webview::PageLoadEvent::Started {
        return;
    }
    let Some(origin) = app_origin(payload.url()) else {
        return;
    };
    let granted = webview.with_webview(move |platform| {
        let Some(webview) = platform.downcast_ref::<tauri_runtime_cef::Webview>() else {
            return;
        };
        let Some(context) = webview
            .browser()
            .host()
            .and_then(|host| host.request_context())
        else {
            return;
        };
        let origin = CefString::from(origin.as_str());
        for setting in [
            ContentSettingTypes::LOOPBACK_NETWORK,
            ContentSettingTypes::LOCAL_NETWORK,
        ] {
            context.set_content_setting(
                Some(&origin),
                Some(&origin),
                setting,
                ContentSettingValues::ALLOW,
            );
        }
    });
    if let Err(error) = granted {
        log::warn!("could not allow local network access for the app: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::app_origin;
    use tauri::Url;

    fn origin(url: &str) -> Option<String> {
        app_origin(&Url::parse(url).unwrap())
    }

    #[test]
    fn grants_the_app_origin() {
        assert_eq!(
            origin("http://tauri.localhost/reader?ids=abc"),
            Some("http://tauri.localhost".to_string())
        );
        assert_eq!(
            origin("https://tauri.localhost/library"),
            Some("https://tauri.localhost".to_string())
        );
    }

    #[test]
    fn leaves_other_pages_to_chromium() {
        // Pages the web browser and clipper windows load, and look-alike hosts.
        assert_eq!(origin("https://example.com/"), None);
        assert_eq!(origin("http://tauri.localhost.example.com/"), None);
        assert_eq!(origin("http://evil.tauri.localhost/"), None);
        assert_eq!(origin("tauri://localhost/"), None);
        // Dev builds already load from loopback.
        assert_eq!(origin("http://localhost:3000/library"), None);
    }
}
