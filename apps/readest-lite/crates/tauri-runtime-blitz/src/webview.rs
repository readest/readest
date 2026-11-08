//! The webview: a Blitz document scripted by QuickJS (blitz-qjs-script), on the event-loop thread.
//!
//! Tauri reaches a webview through four things, and each maps onto Blitz + QuickJS here:
//! - the page URL (`tauri://localhost`): read through the webview's own custom-scheme handlers
//!   (Tauri's asset protocol), as are `<script src>`, stylesheets and images;
//! - initialization scripts: evaluated after `web.js` and before the page's scripts;
//! - IPC: Tauri's `ipc-protocol.js` calls `fetch("ipc://localhost/<cmd>")`, which `web.js` routes to
//!   the `ipc` scheme handler; `window.ipc.postMessage` goes to the IPC handler;
//! - `eval_script` (events, callbacks): evaluated in the page's context.
//!
//! Output is headless: frames are painted with cairo and, with `BLITZ_TAURI_OUT=DIR`, written as
//! PGM files. `BLITZ_TAURI_TAPS="x,y;#sel"` taps CSS-pixel points or the centre of the first
//! element matching a selector, or press `key:Name` (e.g. `key:ArrowRight`), one per painted
//! frame (`BLITZ_TAURI_TAP_MS` apart, default 800); `wait:MS` holds the next one back MS ms more.

use anyrender_cairo as cairo_scene;

use crate::fonts;

use std::{
    borrow::Cow,
    collections::{HashMap, VecDeque},
    rc::Rc,
    sync::{Arc, Mutex, mpsc::Sender},
    time::{Duration, Instant},
};

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::{
    events::{
        BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
        PointerDetails, UiEvent,
    },
    net::{Bytes, NetHandler, NetProvider, Request},
    shell::{ColorScheme, Viewport},
};
use peniko::{Color, Fill, kurbo::Rect};
use rquickjs::{ArrayBuffer, Ctx, Function, Object};
use tauri_runtime::webview::{InitializationScript, UriSchemeProtocolHandler};
use url::Url;

use crate::Message;

pub(crate) type Protocols = Arc<HashMap<String, Box<UriSchemeProtocolHandler>>>;
/// Tauri's IPC handler with the `DetachedWebview` (and so the user-event type) already bound.
pub(crate) type IpcHandler = Box<dyn Fn(http::Request<String>)>;
pub(crate) type PageLoadHandler = Box<dyn Fn(Url, tauri_runtime::webview::PageLoadEvent) + Send>;

const WEB_JS: &str = include_str!("web.js");
/// `DOMParser` (XML), where the page has none: foliate-js reads EPUB package files with it.
const DOM_PARSER_JS: &str = include_str!("dom-parser.js");
/// `Intl` (QuickJS has none): plural rules, segmentation, collation and English formats.
const INTL_JS: &str = include_str!("intl.js");
/// ReadableStream/WritableStream/TransformStream (MIT, web-streams-polyfill 3.3.3): Next.js reads its
/// React Server Components payload through streams.
const STREAMS_JS: &str =
    include_str!("../../../vendor/web-streams-polyfill/polyfill.es2018.min.js");

/// Set when the runtime is created; log lines carry `t_ms` since then.
pub(crate) static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

fn t_ms() -> f64 {
    START
        .get()
        .map_or(0.0, |s| s.elapsed().as_secs_f64() * 1000.0)
}

/// `scheme://host[:port]`, which Tauri's IPC handler wants in the `Origin` header.
fn origin(url: &Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(h), Some(p)) => format!("{}://{h}:{p}", url.scheme()),
        (Some(h), None) => format!("{}://{h}", url.scheme()),
        _ => url.scheme().to_owned(),
    }
}

/// A URL's parts in web.js's `URL_PARTS` order, as the WHATWG getters give them, except `origin`:
/// `scheme://host` for any scheme with a host, as WebKit does for Tauri's `tauri://localhost`.
fn url_parts(u: &Url) -> Vec<String> {
    use url::quirks as q;
    [
        q::href(u),
        q::protocol(u),
        q::username(u),
        q::password(u),
        q::host(u),
        q::hostname(u),
        q::port(u),
        q::pathname(u),
        q::search(u),
        q::hash(u),
    ]
    .into_iter()
    .map(str::to_owned)
    .chain([origin(u)])
    .collect()
}

/// Calls a custom-scheme handler and waits for its answer. Tauri's asset handler answers inline;
/// one that answers from the main thread would deadlock here, hence the timeout.
/// `blob:` URLs (URL.createObjectURL in web.js) and their bytes.
pub(crate) type Blobs = Arc<Mutex<HashMap<String, Vec<u8>>>>;

fn get_sync(protocols: &Protocols, blobs: &Blobs, label: &str, url: &Url) -> Option<Vec<u8>> {
    match url.scheme() {
        "file" => return std::fs::read(url.to_file_path().ok()?).ok(),
        "blob" => return blobs.lock().unwrap().get(url.as_str()).cloned(),
        _ => {}
    }
    let handler = protocols.get(url.scheme())?;
    let (tx, rx) = std::sync::mpsc::channel();
    let req = http::Request::builder()
        .uri(url.as_str())
        .method("GET")
        .body(Vec::new())
        .ok()?;
    handler(
        label,
        req,
        Box::new(move |res| {
            let _ = tx.send(res);
        }),
    );
    let res = rx.recv_timeout(Duration::from_secs(10)).ok()?;
    res.status()
        .is_success()
        .then(|| res.into_body().into_owned())
}

/// Blitz's resource requests (stylesheets, images, fonts), answered on the loop thread.
#[derive(Default)]
struct Net(Mutex<Vec<(Request, Box<dyn NetHandler>)>>);

impl NetProvider for Net {
    fn fetch(&self, _doc_id: usize, request: Request, handler: Box<dyn NetHandler>) {
        self.0.lock().unwrap().push((request, handler));
    }
}

/// Set by Blitz when the rendered document changed (a DOM mutation in the document, an image
/// loaded, ...): the only reason to paint. A JS timer that runs without touching the DOM (a
/// polling interval) must not cost a repaint, which on e-ink is a visible refresh.
#[derive(Default)]
struct Redraw(std::sync::atomic::AtomicBool);

impl blitz_traits::shell::ShellProvider for Redraw {
    fn request_redraw(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// What the JS ops need; shared with their closures.
struct OpState {
    id: u32,
    label: String,
    protocols: Protocols,
    blobs: Blobs,
    ipc: Option<IpcHandler>,
    tx: Sender<Message>,
    url: Arc<Mutex<String>>,
}

pub(crate) struct BlitzWebview {
    pub id: u32,
    pub label: String,
    pub url: Arc<Mutex<String>>,
    doc: Option<QjsDocument>,
    ops: Rc<OpState>,
    init_scripts: Vec<InitializationScript>,
    page_load: Option<PageLoadHandler>,
    net: Arc<Net>,
    redraw: Arc<Redraw>,
    caches: cairo_scene::Caches,
    w: u32,
    h: u32,
    scale: f32,
    dirty: bool,
    frames: u32,
    out: Option<String>,
    taps: VecDeque<String>,
    next_tap: Option<Instant>,
    /// Next frame of a running CSS animation/transition (BLITZ_TAURI_ANIM_MS apart, default 33).
    next_anim: Option<Instant>,
    /// BLITZ_TAURI_EVAL=file.js, evaluated once BLITZ_TAURI_EVAL_MS (default 5000) after navigate.
    probe: Option<(Instant, String)>,
    pointers: Arc<atomic_refcell::AtomicRefCell<Vec<BlitzPointerEvent>>>,
    /// The window's visibility (shared with it): a hidden window runs its page but paints nothing,
    /// so an app with `"visible": false` shows its first frame when it calls `show()`.
    pub visible: Arc<std::sync::atomic::AtomicBool>,
    /// BLITZ_TAURI_WINDOW: frames shown in an X11 window, its input sent back as `Message::Pointer`.
    #[cfg(feature = "window")]
    display: Option<crate::display::Display>,
}

pub(crate) struct WebviewInit {
    pub id: u32,
    pub label: String,
    pub url: Arc<Mutex<String>>,
    pub protocols: Protocols,
    pub ipc: Option<IpcHandler>,
    pub init_scripts: Vec<InitializationScript>,
    pub page_load: Option<PageLoadHandler>,
    pub tx: Sender<Message>,
}

fn env<T: std::str::FromStr>(k: &str, d: T) -> T {
    std::env::var(k)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(d)
}

impl BlitzWebview {
    pub fn new(init: WebviewInit) -> Self {
        // BLITZ_TAURI_SIZE=WxH device pixels (default: a Paperwhite 5 portrait), BLITZ_TAURI_SCALE.
        let size = std::env::var("BLITZ_TAURI_SIZE").unwrap_or("1236x1648".into());
        let (w, h) = size
            .split_once('x')
            .map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap()))
            .unwrap();
        let taps = std::env::var("BLITZ_TAURI_TAPS")
            .unwrap_or_default()
            .split(';')
            .map(|t| t.trim().to_owned())
            .filter(|t| !t.is_empty())
            .collect();
        #[cfg(feature = "window")]
        let display = {
            let (tx, webview) = (init.tx.clone(), init.id);
            crate::display::Display::from_env(
                w,
                h,
                &format!("Readest Lite ({})", init.label),
                move |input| {
                    let _ = tx.send(match input {
                        crate::display::Input::Pointer { x, y, down } => Message::Pointer {
                            webview,
                            x,
                            y,
                            down,
                        },
                        crate::display::Input::Close => Message::Exit(0),
                    });
                },
            )
        };
        Self {
            id: init.id,
            label: init.label.clone(),
            url: init.url.clone(),
            doc: None,
            ops: Rc::new(OpState {
                id: init.id,
                label: init.label,
                protocols: init.protocols,
                blobs: Blobs::default(),
                ipc: init.ipc,
                tx: init.tx,
                url: init.url,
            }),
            init_scripts: init.init_scripts,
            page_load: init.page_load,
            net: Arc::new(Net::default()),
            redraw: Arc::new(Redraw::default()),
            caches: cairo_scene::Caches::new(),
            w,
            h,
            scale: env("BLITZ_TAURI_SCALE", 2.5),
            dirty: false,
            frames: 0,
            out: std::env::var("BLITZ_TAURI_OUT").ok(),
            taps,
            next_tap: None,
            next_anim: None,
            probe: None,
            pointers: Default::default(),
            visible: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            #[cfg(feature = "window")]
            display,
        }
    }

    /// Loads `url`: HTML through the custom-scheme handlers, then `web.js`, the initialization
    /// scripts and the page's scripts.
    pub fn navigate(&mut self, url: &str) {
        let t = Instant::now();
        let Ok(parsed) = Url::parse(url) else {
            log::error!("webview {}: bad url {url}", self.label);
            return;
        };
        *self.url.lock().unwrap() = url.to_owned();
        let html = get_sync(&self.ops.protocols, &self.ops.blobs, &self.label, &parsed)
            .unwrap_or_else(|| {
                log::error!("webview {}: cannot load {url}", self.label);
                Vec::new()
            });
        let font_ctx = std::env::var("BLITZ_FONTS")
            .ok()
            .filter(|d| !d.is_empty())
            .map(|d| fonts::bundled(&d));
        let config = DocumentConfig {
            base_url: Some(url.to_owned()),
            viewport: Some(Viewport::new(
                self.w,
                self.h,
                self.scale,
                ColorScheme::Light,
            )),
            net_provider: Some(self.net.clone()),
            shell_provider: Some(self.redraw.clone()),
            font_ctx,
            ..DocumentConfig::default()
        };
        let mut doc = QjsDocument::from_html(&String::from_utf8_lossy(&html), config);
        let html_ms = t.elapsed().as_secs_f64() * 1000.0;
        doc.context()
            .with(|ctx| install_ops(&ctx, self.ops.clone(), &parsed));
        doc.eval(STREAMS_JS, "web-streams-polyfill.js");
        doc.eval(WEB_JS, "web.js");
        doc.eval(DOM_PARSER_JS, "dom-parser.js");
        doc.eval(INTL_JS, "intl.js");
        for (i, s) in self.init_scripts.iter().enumerate() {
            doc.eval(&s.script, &format!("init-{i}"));
        }
        // BLITZ_TAURI_INIT=file.js: one more initialization script (diagnostics, e.g. hooks that
        // must exist before the page's scripts run).
        if let Some(src) =
            std::env::var_os("BLITZ_TAURI_INIT").and_then(|p| std::fs::read_to_string(p).ok())
        {
            doc.eval(&src, "init-env");
        }
        let (protocols, blobs, label) = (
            self.ops.protocols.clone(),
            self.ops.blobs.clone(),
            self.label.clone(),
        );
        doc.set_script_loader(Box::new(move |u| get_sync(&protocols, &blobs, &label, u)));
        // BLITZ_TAURI_QJS_CACHE=DIR|off (default $HOME/.cache/tauri-runtime-blitz/qjs): page scripts
        // run from cached bytecode after the first launch.
        let cache = match std::env::var("BLITZ_TAURI_QJS_CACHE") {
            Ok(v) if v == "off" => None,
            Ok(v) => Some(std::path::PathBuf::from(v)),
            Err(_) => std::env::var_os("HOME")
                .map(|h| std::path::Path::new(&h).join(".cache/tauri-runtime-blitz/qjs")),
        };
        doc.set_bytecode_cache_dir(cache);
        if let Some(h) = &self.page_load {
            h(
                parsed.clone(),
                tauri_runtime::webview::PageLoadEvent::Started,
            );
        }
        let t_scripts = Instant::now();
        doc.execute_scripts();
        let scripts_ms = t_scripts.elapsed().as_secs_f64() * 1000.0;
        if let Some(h) = &self.page_load {
            h(parsed, tauri_runtime::webview::PageLoadEvent::Finished);
        }
        self.doc = Some(doc);
        self.dirty = true;
        self.probe = std::env::var("BLITZ_TAURI_EVAL")
            .ok()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .map(|src| {
                (
                    Instant::now() + Duration::from_millis(env("BLITZ_TAURI_EVAL_MS", 5000)),
                    src,
                )
            });
        self.report_js();
        eprintln!(
            "{{\"label\": \"navigate\", \"t_ms\": {:.1}, \"url\": \"{url}\", \"html_ms\": {html_ms:.1}, \"scripts_ms\": {scripts_ms:.1}, \"total_ms\": {:.1}}}",
            t_ms(),
            t.elapsed().as_secs_f64() * 1000.0
        );
    }

    pub fn eval(&mut self, script: &str) {
        if let Some(doc) = self.doc.as_mut() {
            doc.eval(script, "eval_script");
        }
    }

    pub fn fetch_done(&mut self, id: u32, res: http::Response<Cow<'static, [u8]>>) {
        let Some(doc) = self.doc.as_mut() else { return };
        let status = res.status().as_u16();
        if std::env::var_os("BLITZ_TAURI_TRACE_FETCH").is_some() {
            let body = String::from_utf8_lossy(&res.body()[..res.body().len().min(160)])
                .replace('\n', " ");
            eprintln!("fetch #{id} -> {status} @{:.1} {body}", t_ms());
        }
        let headers: Vec<String> = res
            .headers()
            .iter()
            .flat_map(|(k, v)| {
                [
                    k.as_str().to_owned(),
                    v.to_str().unwrap_or_default().to_owned(),
                ]
            })
            .collect();
        let body = res.into_body().into_owned();
        doc.context().with(|ctx| {
            let Ok(f) = ctx.globals().get::<_, Function>("__tauriFetchDone") else {
                return;
            };
            let Ok(buf) = ArrayBuffer::new(ctx.clone(), body) else {
                return;
            };
            if let Err(e) = f.call::<_, ()>((id, status, headers, buf)) {
                log::error!("__tauriFetchDone: {e}");
            }
        });
        doc.run_jobs();
    }

    /// When the loop should wake for this webview: a due JS timer, a pending paint or tap.
    pub fn deadline(&self) -> Option<Instant> {
        let now = Instant::now();
        let timer = self.doc.as_ref().and_then(QjsDocument::next_wake_deadline);
        let shown = self.visible.load(std::sync::atomic::Ordering::Relaxed);
        let soon = ((self.dirty && shown) || !self.net.0.lock().unwrap().is_empty()).then_some(now);
        [
            timer,
            soon,
            self.next_tap,
            self.next_anim,
            self.probe.as_ref().map(|p| p.0),
        ]
        .into_iter()
        .flatten()
        .min()
    }

    /// One loop turn: resources, due timers, a due tap, then a paint if anything changed.
    pub fn tick(&mut self) {
        let Some(doc) = self.doc.as_mut() else { return };
        let queue = std::mem::take(&mut *self.net.0.lock().unwrap());
        for (req, handler) in queue {
            let url = req.url.to_string();
            match get_sync(&self.ops.protocols, &self.ops.blobs, &self.label, &req.url) {
                Some(b) => handler.bytes(url, Bytes::from(b)),
                None => handler.error(url, "not found".into()),
            }
            self.dirty = true;
        }
        doc.poll(None);
        if self
            .probe
            .as_ref()
            .is_some_and(|(at, _)| *at <= Instant::now())
            && let Some((_, src)) = self.probe.take()
        {
            doc.eval(&src, "probe");
            doc.run_jobs();
        }
        let tap_due = self.next_tap.is_some_and(|t| t <= Instant::now());
        // Input lines carry the time the input was sent and how long its handlers ran.
        let t0 = t_ms();
        // `wait:MS` holds the next input back MS ms more (e.g. while a book opens).
        if tap_due
            && let Some(ms) = self.taps.front().and_then(|t| t.strip_prefix("wait:"))
        {
            let ms = ms.parse().unwrap_or(0);
            self.taps.pop_front();
            self.next_tap = Some(Instant::now() + Duration::from_millis(ms));
        } else if tap_due && let Some(name) = self.taps.front().and_then(|t| t.strip_prefix("key:")) {
            let ok = [true, false]
                .into_iter()
                .all(|down| send_key(doc, name, down));
            eprintln!(
                "{{\"label\": \"key\", \"t_ms\": {t0:.1}, \"handler_ms\": {:.1}, \"key\": \"{name}\", \"ok\": {ok}}}",
                t_ms() - t0
            );
            self.taps.pop_front();
            self.next_tap = None;
            self.dirty = true;
        } else if tap_due && let Some(target) = self.taps.pop_front() {
            let point = match target
                .split_once(',')
                .and_then(|(x, y)| Some((x.trim().parse().ok()?, y.trim().parse().ok()?)))
            {
                Some(p) => Some(p),
                None => {
                    let mut d = doc.inner_mut();
                    d.resolve(blitz_qjs_script::animation_time());
                    let id = d.query_selector(&target).ok().flatten();
                    id.and_then(|id| d.get_client_bounding_rect(id))
                        .map(|r| ((r.x + r.width / 2.0) as f32, (r.y + r.height / 2.0) as f32))
                }
            };
            let Some((x, y)) = point else {
                eprintln!(
                    "{{\"label\": \"tap\", \"target\": \"{target}\", \"error\": \"not found\"}}"
                );
                self.next_tap = None;
                return;
            };
            let t0 = t_ms();
            for down in [true, false] {
                send_pointer(doc, &self.pointers, x, y, down);
            }
            eprintln!(
                "{{\"label\": \"tap\", \"t_ms\": {t0:.1}, \"handler_ms\": {:.1}, \"target\": \"{target}\", \"x\": {x:.0}, \"y\": {y:.0}}}",
                t_ms() - t0
            );
            self.next_tap = None;
            self.dirty = true;
        }
        if self
            .redraw
            .0
            .swap(false, std::sync::atomic::Ordering::Relaxed)
            || self.next_anim.is_some_and(|t| t <= Instant::now())
        {
            self.dirty = true;
        }
        self.report_js();
        // Paint once the page has settled: nothing due within a frame.
        let busy = self
            .doc
            .as_ref()
            .and_then(QjsDocument::next_timer_deadline)
            .is_some_and(|d| d <= Instant::now() + Duration::from_millis(16));
        if self.dirty && !busy && self.visible.load(std::sync::atomic::Ordering::Relaxed) {
            self.paint();
        }
    }

    /// Pointer input from the display window at device pixels `x`, `y`. Repaints only if the page
    /// asks for it (a click that changes nothing paints nothing).
    #[cfg_attr(not(feature = "window"), allow(dead_code))]
    pub fn pointer(&mut self, x: f32, y: f32, down: bool) {
        let Some(doc) = self.doc.as_mut() else { return };
        send_pointer(doc, &self.pointers, x / self.scale, y / self.scale, down);
    }

    fn report_js(&mut self) {
        let Some(doc) = self.doc.as_mut() else { return };
        for e in doc.take_js_errors() {
            eprintln!("js error [{}]: {e}", self.label);
        }
        for m in doc.take_messages() {
            eprintln!("console [{}]: {m}", self.label);
        }
    }

    fn paint(&mut self) {
        let Some(doc) = self.doc.as_mut() else { return };
        let t = Instant::now();
        doc.inner_mut().resolve(blitz_qjs_script::animation_time());
        // ResizeObserver callbacks see the new layout; if any fired, the page is about to change
        // again, so paint once that settles (they only fire on size changes, so this ends).
        if doc.call_global("__blitzAfterLayout", ()).unwrap_or(0.0) > 0.0 {
            self.report_js();
            return;
        }
        let Some(doc) = self.doc.as_mut() else { return };
        let layout_ms = t.elapsed().as_secs_f64() * 1000.0;
        let surface =
            cairo::ImageSurface::create(cairo::Format::Rgb24, self.w as i32, self.h as i32)
                .unwrap();
        {
            let cr = cairo::Context::new(&surface).unwrap();
            let mut scene = cairo_scene::CairoScene::new(cr, &mut self.caches);
            let all = Rect::new(0.0, 0.0, f64::from(self.w), f64::from(self.h));
            scene.fill(
                Fill::NonZero,
                Default::default(),
                Color::WHITE,
                Default::default(),
                &all,
            );
            paint_scene(
                &mut scene,
                &mut doc.inner_mut(),
                f64::from(self.scale),
                self.w,
                self.h,
                0,
                0,
            );
        }
        surface.flush();
        let paint_ms = t.elapsed().as_secs_f64() * 1000.0 - layout_ms;
        #[cfg(feature = "window")]
        if let Some(d) = &self.display {
            let stride = surface.stride() as usize;
            let _ = surface.with_data(|data| d.present(data, stride));
        }
        if let Some(out) = &self.out {
            let stride = surface.stride() as usize;
            let mut surface = surface;
            let data = surface.data().unwrap();
            let (w, h) = (self.w as usize, self.h as usize);
            let mut pgm = format!("P5\n{w} {h}\n255\n").into_bytes();
            for y in 0..h {
                pgm.extend(
                    data[y * stride..y * stride + w * 4]
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|p| {
                            ((u32::from(p[2]) * 77 + u32::from(p[1]) * 150 + u32::from(p[0]) * 29)
                                >> 8) as u8
                        }),
                );
            }
            let _ = std::fs::write(format!("{out}/{}-{:03}.pgm", self.label, self.frames), pgm);
        }
        // BLITZ_TAURI_DUMP=1: the DOM as HTML next to each frame (diagnostics).
        if let (Some(out), Some(_)) = (&self.out, std::env::var_os("BLITZ_TAURI_DUMP")) {
            let html = doc.inner().root_element().outer_html();
            let _ = std::fs::write(
                format!("{out}/{}-{:03}.html", self.label, self.frames),
                html,
            );
        }
        let (heap, _) = doc.js_memory();
        eprintln!(
            "{{\"label\": \"frame\", \"t_ms\": {:.1}, \"n\": {}, \"layout_ms\": {layout_ms:.1}, \"paint_ms\": {paint_ms:.1}, \"js_heap_kb\": {}}}",
            t_ms(),
            self.frames,
            heap / 1024
        );
        self.frames += 1;
        self.dirty = false;
        // Keep painting only while something animates; an idle page paints nothing.
        self.next_anim = self
            .doc
            .as_ref()
            .is_some_and(|d| d.inner().is_animating())
            .then(|| Instant::now() + Duration::from_millis(env("BLITZ_TAURI_ANIM_MS", 33)));
        if !self.taps.is_empty() && self.next_tap.is_none() {
            self.next_tap =
                Some(Instant::now() + Duration::from_millis(env("BLITZ_TAURI_TAP_MS", 800)));
        }
    }
}

/// `__tauri.*`, the native side of `web.js`.
/// A primary pointer down or up at CSS pixels `x`, `y` (a finger, as on a touch screen).
fn send_pointer(
    doc: &mut QjsDocument,
    pointers: &Arc<atomic_refcell::AtomicRefCell<Vec<BlitzPointerEvent>>>,
    x: f32,
    y: f32,
    down: bool,
) {
    let p = BlitzPointerEvent {
        id: BlitzPointerId::Finger(0),
        is_primary: true,
        coords: PointerCoords {
            page_x: x,
            page_y: y,
            screen_x: x,
            screen_y: y,
            client_x: x,
            client_y: y,
        },
        button: MouseEventButton::Main,
        buttons: if down {
            MouseEventButtons::Primary
        } else {
            MouseEventButtons::None
        },
        mods: Default::default(),
        details: PointerDetails::default(),
        element: Default::default(),
        active_pointers: Arc::clone(pointers),
    };
    doc.handle_ui_event(if down {
        UiEvent::PointerDown(p)
    } else {
        UiEvent::PointerUp(p)
    });
}

/// A key press or release: `name` is a key name such as `ArrowRight`, also taken as its code.
/// False when it is not both.
fn send_key(doc: &mut QjsDocument, name: &str, down: bool) -> bool {
    use blitz_traits::events::{BlitzKeyEvent, KeyState};
    let (Ok(key), Ok(code)) = (name.parse(), name.parse()) else {
        return false;
    };
    let k = BlitzKeyEvent {
        key,
        code,
        modifiers: Default::default(),
        location: Default::default(),
        is_auto_repeating: false,
        is_composing: false,
        state: if down {
            KeyState::Pressed
        } else {
            KeyState::Released
        },
        text: None,
    };
    doc.handle_ui_event(if down {
        UiEvent::KeyDown(k)
    } else {
        UiEvent::KeyUp(k)
    });
    true
}

/// `format` as in the Compression Streams spec: "deflate" (zlib), "deflate-raw" or "gzip".
/// `None` for an unknown format or corrupt input.
fn zlib(compress: bool, format: &str, data: &[u8]) -> Option<Vec<u8>> {
    use flate2::{Compression, read};
    use std::io::Read;
    let mut out = Vec::new();
    let level = Compression::default();
    let res = match (compress, format) {
        (true, "deflate") => read::ZlibEncoder::new(data, level).read_to_end(&mut out),
        (true, "deflate-raw") => read::DeflateEncoder::new(data, level).read_to_end(&mut out),
        (true, "gzip") => read::GzEncoder::new(data, level).read_to_end(&mut out),
        (false, "deflate") => read::ZlibDecoder::new(data).read_to_end(&mut out),
        (false, "deflate-raw") => read::DeflateDecoder::new(data).read_to_end(&mut out),
        (false, "gzip") => read::MultiGzDecoder::new(data).read_to_end(&mut out),
        _ => return None,
    };
    res.ok().map(|_| out)
}

fn install_ops<'js>(ctx: &Ctx<'js>, st: Rc<OpState>, page: &Url) {
    let t = Object::new(ctx.clone()).unwrap();
    macro_rules! op {
        ($name:literal, $f:expr) => {
            t.set(
                $name,
                Function::new(ctx.clone(), $f)
                    .unwrap()
                    .with_name($name)
                    .unwrap(),
            )
            .unwrap();
        };
    }
    t.set("origin", origin(page)).unwrap();

    op!("utf8Encode", |ctx: Ctx<'js>, s: String| ArrayBuffer::new(
        ctx,
        s.into_bytes()
    ));
    op!("utf8Decode", |b: ArrayBuffer<'js>| String::from_utf8_lossy(
        b.as_bytes().unwrap_or_default()
    )
    .into_owned());
    // FileReader.readAsDataURL (web.js): standard base64 with padding.
    op!("base64", |b: ArrayBuffer<'js>| {
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes = b.as_bytes().unwrap_or_default();
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for c in bytes.chunks(3) {
            let n = c
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, &x)| n | u32::from(x) << (16 - 8 * i));
            for i in 0..4 {
                out.push(if i <= c.len() {
                    A[(n >> (18 - 6 * i) & 63) as usize] as char
                } else {
                    '='
                });
            }
        }
        out
    });
    op!("random", |ctx: Ctx<'js>, n: usize| {
        let mut buf = vec![0u8; n];
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            let _ = std::io::Read::read_exact(&mut f, &mut buf);
        }
        ArrayBuffer::new(ctx, buf)
    });
    // CompressionStream/DecompressionStream (web.js): one (de)compression of a whole stream.
    op!("zlib", |ctx: Ctx<'js>,
                 compress: bool,
                 format: String,
                 data: ArrayBuffer<'js>|
     -> rquickjs::Result<Option<ArrayBuffer<'js>>> {
        let out = zlib(compress, &format, data.as_bytes().unwrap_or_default());
        out.map(|v| ArrayBuffer::new(ctx, v)).transpose()
    });
    // URL.createObjectURL/revokeObjectURL and fetch(blob:) (web.js); Blitz's loads read the same
    // store (get_sync).
    let s = st.clone();
    op!("blobPut", move |url: String, data: ArrayBuffer<'js>| {
        let bytes = data.as_bytes().unwrap_or_default().to_vec();
        s.blobs.lock().unwrap().insert(url, bytes);
    });
    let s = st.clone();
    op!("blobDel", move |url: String| {
        s.blobs.lock().unwrap().remove(&url);
    });
    let s = st.clone();
    op!("blobGet", move |ctx: Ctx<'js>,
                         url: String|
          -> rquickjs::Result<
        Option<ArrayBuffer<'js>>,
    > {
        let bytes = s.blobs.lock().unwrap().get(&url).cloned();
        bytes.map(|b| ArrayBuffer::new(ctx, b)).transpose()
    });
    op!("parseUrl", |href: String,
                     base: Option<String>|
     -> Option<Vec<String>> {
        let u = match base {
            Some(b) => Url::parse(&b).ok()?.join(&href).ok()?,
            None => Url::parse(&href).ok()?,
        };
        Some(url_parts(&u))
    });
    // A URL setter (web.js): `href` with `part` set to `value`, or None when `href` is set to
    // something that does not parse (the others ignore invalid values, as browsers do).
    op!("setUrl", |href: String,
                   part: String,
                   value: String|
     -> Option<Vec<String>> {
        use url::quirks as q;
        let mut u = Url::parse(&href).ok()?;
        match part.as_str() {
            "href" => q::set_href(&mut u, &value).ok()?,
            "protocol" => q::set_protocol(&mut u, &value).unwrap_or(()),
            "username" => q::set_username(&mut u, &value).unwrap_or(()),
            "password" => q::set_password(&mut u, &value).unwrap_or(()),
            "host" => q::set_host(&mut u, &value).unwrap_or(()),
            "hostname" => q::set_hostname(&mut u, &value).unwrap_or(()),
            "port" => q::set_port(&mut u, &value).unwrap_or(()),
            "pathname" => q::set_pathname(&mut u, &value),
            "search" => q::set_search(&mut u, &value),
            "hash" => q::set_hash(&mut u, &value),
            _ => return None,
        }
        Some(url_parts(&u))
    });

    let s = st.clone();
    op!("postMessage", move |body: String| {
        if let Some(ipc) = &s.ipc {
            let url = s.url.lock().unwrap().clone();
            if let Ok(req) = http::Request::builder().uri(url).body(body) {
                ipc(req);
            }
        }
    });

    let s = st;
    op!("fetch", move |id: u32,
                       url: String,
                       method: String,
                       headers: Vec<String>,
                       body: Option<ArrayBuffer<'js>>|
          -> Option<String> {
        let parsed = Url::parse(&url).ok()?;
        // BLITZ_TAURI_TRACE_FETCH=1: each fetch (Tauri IPC included) and its answer on stderr.
        if std::env::var_os("BLITZ_TAURI_TRACE_FETCH").is_some() {
            eprintln!("fetch #{id} {method} @{:.1} {url}", t_ms());
        }
        let Some(handler) = s.protocols.get(parsed.scheme()) else {
            return Some(format!(
                "no handler for {}: (only the webview's custom schemes)",
                parsed.scheme()
            ));
        };
        let mut req = http::Request::builder()
            .uri(url.as_str())
            .method(method.as_str());
        for kv in headers.as_chunks::<2>().0 {
            req = req.header(kv[0].as_str(), kv[1].as_str());
        }
        let body = body
            .and_then(|b| b.as_bytes().map(<[u8]>::to_vec))
            .unwrap_or_default();
        let req = match req.body(body) {
            Ok(r) => r,
            Err(e) => return Some(e.to_string()),
        };
        let (tx, webview) = (s.tx.clone(), s.id);
        handler(
            &s.label,
            req,
            Box::new(move |response| {
                if std::env::var_os("BLITZ_TAURI_TRACE_FETCH").is_some() {
                    eprintln!(
                        "fetch #{id} responded @{:.1} on {:?}",
                        t_ms(),
                        std::thread::current().name()
                    );
                }
                let _ = tx.send(Message::FetchDone {
                    webview,
                    id,
                    response,
                });
            }),
        );
        None
    });
    ctx.globals().set("__tauri", t).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs `script` after web.js, as on a page; returns the console.log lines.
    fn page(script: &str) -> Vec<String> {
        let url = Url::parse("tauri://localhost/").unwrap();
        let st = Rc::new(OpState {
            id: 0,
            label: "test".into(),
            protocols: Arc::new(HashMap::new()),
            blobs: Blobs::default(),
            ipc: None,
            tx: std::sync::mpsc::channel().0,
            url: Arc::new(Mutex::new(url.to_string())),
        });
        let mut doc =
            QjsDocument::from_html("<html><body></body></html>", DocumentConfig::default());
        doc.context().with(|ctx| install_ops(&ctx, st, &url));
        doc.eval(STREAMS_JS, "web-streams-polyfill.js");
        doc.eval(WEB_JS, "web.js");
        doc.eval(script, "test");
        doc.run_jobs();
        assert_eq!(doc.take_js_errors(), Vec::<String>::new());
        doc.take_messages()
            .into_iter()
            .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
            .collect()
    }

    #[test]
    fn file_reader_reads_a_blob() {
        // readest-app's convertBlobUrlToDataUrl: onloadend, then `result`
        let logs = page(
            "const b = new Blob([new Uint8Array([0xff, 0, 0x80, 0x41]), 'é'], { type: 'image/png' });
            const r = new FileReader();
            r.onloadend = () => console.log('url', r.readyState, r.result);
            r.readAsDataURL(b);
            const a = new FileReader();
            a.addEventListener('load', (e) => console.log('buffer', e.target === a, new Uint8Array(a.result).join(' ')));
            a.readAsArrayBuffer(b.slice(0, 3));
            const s = new FileReader();
            s.onload = () => console.log('text', s.result);
            s.readAsText(new Blob(['héllo']));
            const p = new FileReader();
            p.onload = () => console.log('padded', p.result);
            p.readAsDataURL(new Blob(['ab']));
            console.log('sync', r.readyState, r.result);",
        );
        assert_eq!(
            logs,
            [
                "sync 1 null",
                "buffer true 255 0 128",
                "text héllo",
                "padded data:application/octet-stream;base64,YWI=",
                // loadend follows load
                "url 2 data:image/png;base64,/wCAQcOp",
            ]
        );
    }
}
