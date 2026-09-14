//! Use WebKit directly: Wry's cookie conversion drops the leading dot that
//! distinguishes a domain cookie from a host-only cookie.
use cocoa::base::id;
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::CStr;
use tauri::Url;

unsafe fn string(value: id) -> String {
    let ptr: *const std::os::raw::c_char = unsafe { msg_send![value, UTF8String] };
    if ptr.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned()
    }
}

pub fn cookies<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    url: &Url,
    updates: Vec<String>,
) -> Result<String, String> {
    if !updates.is_empty() {
        let (updated_tx, updated_rx) = std::sync::mpsc::channel();
        let update_url = url.clone();
        webview.with_webview(move |native| unsafe {
            let configuration: id = msg_send![native.inner() as id, configuration];
            let data_store: id = msg_send![configuration, websiteDataStore];
            let store: id = msg_send![data_store, httpCookieStore];
            let url = update_url;
            let pending = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(1));
            // Native cookie parsing preserves domain/host-only semantics and expiry.
            use cocoa::foundation::NSString;
            let url_string = NSString::alloc(cocoa::base::nil).init_str(url.as_str());
            let native_url: id = msg_send![class!(NSURL), URLWithString: url_string];
            let key = NSString::alloc(cocoa::base::nil).init_str("Set-Cookie");
            for header in updates {
                let value = NSString::alloc(cocoa::base::nil).init_str(&header);
                let fields: id = msg_send![class!(NSDictionary), dictionaryWithObject: value forKey: key];
                let cookies: id = msg_send![class!(NSHTTPCookie), cookiesWithResponseHeaderFields: fields forURL: native_url];
                let count: usize = msg_send![cookies, count];
                for index in 0..count {
                    let cookie: id = msg_send![cookies, objectAtIndex: index];
                    let domain: id = msg_send![cookie, domain];
                    if super::browser_fetch::cookie_domain_matches(&string(domain), url.host_str().unwrap_or_default()) {
                        pending.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let count = pending.clone();
                        let done = updated_tx.clone();
                        let completion = block::ConcreteBlock::new(move || {
                            if count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) == 1 { let _ = done.send(()); }
                        }).copy();
                        let _: () = msg_send![store, setCookie: cookie completionHandler: &*completion];
                    }
                }
                let _: () = msg_send![value, release];
            }
            let _: () = msg_send![key, release];
            let _: () = msg_send![url_string, release];

            if pending.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) == 1 { let _ = updated_tx.send(()); }
        }).map_err(|e| e.to_string())?;
        updated_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "Could not update browser session")?;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let url = url.clone();
    webview
        .with_webview(move |native| unsafe {
            let configuration: id = msg_send![native.inner() as id, configuration];
            let data_store: id = msg_send![configuration, websiteDataStore];
            let store: id = msg_send![data_store, httpCookieStore];
            let callback = block::ConcreteBlock::new(move |cookies: id| {
                let count: usize = msg_send![cookies, count];
                let mut values = Vec::new();
                for index in 0..count {
                    let cookie: id = msg_send![cookies, objectAtIndex: index];
                    let domain: id = msg_send![cookie, domain];
                    let path: id = msg_send![cookie, path];
                    let secure: bool = msg_send![cookie, isSecure];
                    let expires: id = msg_send![cookie, expiresDate];
                    let expired = !expires.is_null() && {
                        let remaining: f64 = msg_send![expires, timeIntervalSinceNow];
                        remaining <= 0.0
                    };
                    let path = string(path);
                    if !expired
                        && super::browser_fetch::cookie_scope_matches(
                            &string(domain),
                            &path,
                            secure,
                            &url,
                        )
                    {
                        let name: id = msg_send![cookie, name];
                        let value: id = msg_send![cookie, value];
                        values.push((path.len(), format!("{}={}", string(name), string(value))));
                    }
                }
                values.sort_by_key(|(length, _)| std::cmp::Reverse(*length));
                let _ = tx.send(
                    values
                        .into_iter()
                        .map(|(_, value)| value)
                        .collect::<Vec<_>>()
                        .join("; "),
                );
            })
            .copy();
            let _: () = msg_send![store, getAllCookies: &*callback];
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "Could not read browser session".into())
}
