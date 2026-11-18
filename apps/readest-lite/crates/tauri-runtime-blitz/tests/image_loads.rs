//! `<img>` and `new Image()` load as in a browser: `load` or `error` fires once the image has
//! arrived or failed (a fetch error or bytes that aren't an image), `complete`, `naturalWidth` and
//! `naturalHeight` follow, and `decode()` settles with it. readest-app's covers show their spine
//! and report their aspect ratio on `load`, its image viewer fits the image on `load`, and
//! foliate-js sizes fixed-layout pages and section backgrounds with `new Image()`. Lite had no
//! `Image`, no events and no natural size.
//!
//! The expected lines are Chromium's, but one: an image whose URL has already loaded completes at
//! once ("f sync true 2"), as HTML's list of available images has it. Chromium did so only when its
//! memory cache kept the response; the route that served this test's images wasn't cached.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::net::{Bytes, NetHandler, NetProvider, Request};
use std::sync::{Arc, Mutex};

const PNG_2X3: &[u8] = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x02\x00\x00\x00\x03\x08\x02\x00\x00\x00\x36\x88\x49\xd6\x00\x00\x00\x13\x49\x44\x41\x54\x78\x9c\x63\xfc\xcf\xc0\xc0\xc0\xc0\xc0\xc4\x80\x4c\x01\x00\x14\x40\x01\x05\xdd\x23\x79\x0e\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82";

/// Holds requests until `serve` answers them: a 2x3 PNG, bytes that aren't an image, or an error.
#[derive(Default)]
struct Net(Mutex<Vec<(Request, Box<dyn NetHandler>)>>);
impl NetProvider for Net {
    fn fetch(&self, _doc_id: usize, request: Request, handler: Box<dyn NetHandler>) {
        self.0.lock().unwrap().push((request, handler));
    }
}
impl Net {
    fn serve(&self) {
        let pending = std::mem::take(&mut *self.0.lock().unwrap());
        for (request, handler) in pending {
            let url = request.url.to_string();
            if url.ends_with("2x3.png") {
                handler.bytes(url, Bytes::from_static(PNG_2X3));
            } else if url.ends_with("bad.png") {
                handler.bytes(url, Bytes::from_static(b"not an image"));
            } else {
                handler.error(url, "not found".into());
            }
        }
    }
}

#[test]
fn images_load_and_fail_as_in_a_browser() {
    let net = Arc::new(Net::default());
    let config = DocumentConfig {
        net_provider: Some(net.clone()),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html("<!DOCTYPE html><html><body></body></html>", config);
    // As the host runs: the fetches complete, the page is laid out, then the hook runs.
    let mut run = |script: &str| {
        doc.eval(script, "test");
        doc.run_jobs();
        for _ in 0..3 {
            net.serve();
            doc.inner_mut().resolve(0.0);
            doc.call_global("__blitzAfterLayout", ());
            doc.run_jobs();
        }
    };
    run("globalThis.log = (...a) => console.log(a.join(' '));");
    run(r#"
        const a = new Image();
        log('new', a instanceof HTMLImageElement, a.localName, a.complete, a.naturalWidth, a.naturalHeight);
        a.onload = () => log('a load', a.complete, a.naturalWidth, a.naturalHeight);
        a.src = 'http://x/2x3.png';
        log('a sync', a.complete, a.naturalWidth);
        const b = document.createElement('img');
        document.body.append(b);
        b.addEventListener('error', () => log('b error', b.complete, b.naturalWidth));
        b.src = 'http://x/missing.png';
        const c = new Image();
        c.onerror = () => log('c error', c.complete, c.naturalWidth);
        c.src = 'http://x/bad.png';
        const d = new Image();
        d.src = 'http://x/missing.png';
        d.decode().then(() => log('d decoded'), (e) => log('d', e.name));
        const e = new Image(4, 5);
        e.src = 'http://x/2x3.png';
        e.decode().then(() => log('e decoded', e.naturalWidth, e.naturalHeight, e.getAttribute('width'), e.getAttribute('height')));
        "#);
    run(r#"
        const f = new Image();
        f.onload = () => log('f load', f.complete);
        f.src = 'http://x/2x3.png';
        log('f sync', f.complete, f.naturalWidth);
        f.decode().then(() => log('f decoded'));
        "#);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let mut logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    // The order the fetches complete in is the network's.
    logs[2..].sort();
    assert_eq!(
        logs,
        [
            "new true img true 0 0",
            "a sync false 0",
            "a load true 2 3",
            "b error true 0",
            "c error true 0",
            "d EncodingError",
            "e decoded 2 3 4 5",
            "f decoded",
            "f load true",
            "f sync true 2",
        ]
    );
}
