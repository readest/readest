//! `fetch` to http(s) URLs: what a page asks of the network (Readest's sign-in and sync). Each
//! request runs on a thread of its own, through one agent: rustls with Mozilla's root
//! certificates (webpki-roots), so a Kindle's years-old CA store doesn't matter. Like a browser,
//! a status is an answer, not an error; only a network failure fails the fetch.

use std::{borrow::Cow, sync::LazyLock, time::Duration};

use crate::webview::FetchResult;

/// How long the network may go quiet before a fetch fails.
const STALL: Duration = Duration::from_secs(60);

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| agent(STALL));

/// The agent `fetch` uses, for the app's own downloads (Lite's `download_file`).
pub fn http_agent() -> &'static ureq::Agent {
    &AGENT
}

fn agent(stall: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        // A stalled server or a dropped Wi-Fi fails the fetch instead of holding it forever, also
        // partway through a body; a long download is still fine while its bytes keep coming.
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(stall))
        .timeout_per_read(Some(stall))
        .timeout_per_write(Some(stall))
        .build()
        .into()
}

/// Sends `req` and hands `done` its answer, on another thread.
pub(crate) fn send(req: http::Request<Vec<u8>>, done: impl FnOnce(FetchResult) + Send + 'static) {
    let run = move || done(run(&AGENT, req).map_err(|e| e.to_string()));
    if let Err(e) = std::thread::Builder::new().name("fetch".into()).spawn(run) {
        log::error!("fetch thread: {e}");
    }
}

fn run(
    agent: &ureq::Agent,
    req: http::Request<Vec<u8>>,
) -> Result<http::Response<Cow<'static, [u8]>>, ureq::Error> {
    let (parts, body) = req.into_parts();
    // No body at all for an empty one: a GET would otherwise go out with `Content-Length: 0`.
    let res = if body.is_empty() {
        agent.run(http::Request::from_parts(parts, ()))?
    } else {
        agent.run(http::Request::from_parts(parts, body))?
    };
    let (parts, body) = res.into_parts();
    let bytes = body.into_with_config().limit(u64::MAX).read_to_vec()?;
    Ok(http::Response::from_parts(parts, Cow::Owned(bytes)))
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        time::Duration,
    };

    use super::{agent, run};

    /// Sends `req` through an agent whose stall limit is half a second; what it got within 5 s.
    fn fetch_within_5s(req: http::Request<Vec<u8>>) -> Option<Result<u16, String>> {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let res = run(&agent(Duration::from_millis(500)), req);
            let _ = tx.send(res.map(|r| r.status().as_u16()).map_err(|e| e.to_string()));
        });
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }

    /// The Kindle's library pull of 2026-11-24 waited 4 hours: an answer that stops partway
    /// through its body fails the fetch once the network has been quiet for the stall limit.
    #[test]
    fn a_body_that_stops_coming_fails_the_fetch() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/sync", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"books\":[");
            std::thread::sleep(Duration::from_secs(30));
        });
        let got = fetch_within_5s(http::Request::get(url).body(Vec::new()).unwrap());
        let err = got
            .expect("the fetch was still waiting after 5 s")
            .unwrap_err();
        assert!(err.contains("timeout"), "{err}");
    }

    /// A request body the server stops taking fails the same way.
    #[test]
    fn a_request_body_that_stops_going_fails_the_fetch() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/sync", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let _held = listener.accept().unwrap();
            std::thread::sleep(Duration::from_secs(30));
        });
        // More than the two sockets' buffers hold, so the writes have to wait for the server.
        let body = vec![b'x'; 64 << 20];
        let got = fetch_within_5s(http::Request::post(url).body(body).unwrap());
        let err = got
            .expect("the fetch was still waiting after 5 s")
            .unwrap_err();
        assert!(err.contains("timeout"), "{err}");
    }

    /// A slow answer whose bytes keep coming is not a stall, however long it takes in all.
    #[test]
    fn a_slow_body_that_keeps_coming_is_read_whole() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/cover.png", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n");
            for _ in 0..8 {
                std::thread::sleep(Duration::from_millis(300));
                let _ = stream.write_all(b"x");
            }
        });
        let got = fetch_within_5s(http::Request::get(url).body(Vec::new()).unwrap());
        assert_eq!(got, Some(Ok(200)));
    }
}
