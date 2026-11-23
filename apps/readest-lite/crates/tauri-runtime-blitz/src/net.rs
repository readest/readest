//! `fetch` to http(s) URLs: what a page asks of the network (Readest's sign-in and sync). Each
//! request runs on a thread of its own, through one agent: rustls with Mozilla's root
//! certificates (webpki-roots), so a Kindle's years-old CA store doesn't matter. Like a browser,
//! a status is an answer, not an error; only a network failure fails the fetch.

use std::{borrow::Cow, sync::LazyLock, time::Duration};

use crate::webview::FetchResult;

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        // A stalled server or a dropped Wi-Fi fails the fetch instead of holding it forever;
        // a long download is still fine (no limit on the body).
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .build()
        .into()
});

/// Sends `req` and hands `done` its answer, on another thread.
pub(crate) fn send(req: http::Request<Vec<u8>>, done: impl FnOnce(FetchResult) + Send + 'static) {
    let run = move || done(run(req).map_err(|e| e.to_string()));
    if let Err(e) = std::thread::Builder::new().name("fetch".into()).spawn(run) {
        log::error!("fetch thread: {e}");
    }
}

fn run(req: http::Request<Vec<u8>>) -> Result<http::Response<Cow<'static, [u8]>>, ureq::Error> {
    let (parts, body) = req.into_parts();
    // No body at all for an empty one: a GET would otherwise go out with `Content-Length: 0`.
    let res = if body.is_empty() {
        AGENT.run(http::Request::from_parts(parts, ()))?
    } else {
        AGENT.run(http::Request::from_parts(parts, body))?
    };
    let (parts, body) = res.into_parts();
    let bytes = body.into_with_config().limit(u64::MAX).read_to_vec()?;
    Ok(http::Response::from_parts(parts, Cow::Owned(bytes)))
}
