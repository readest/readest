//! JavaScript for Blitz on QuickJS-NG (rquickjs), a port of `blitz-vibey-script`'s idea with a
//! different split: Rust exposes a small set of node-id operations (`__n.*`, in [`ops`]) over
//! `blitz-dom`, and `bootstrap.js` builds the DOM in JavaScript on top of them (Node, Element,
//! Text, Document, CSSStyleDeclaration, EventTarget with capture/target/bubble dispatch, timers,
//! window). `bootstrap.js` is compiled to bytecode at build time (build.rs) and embedded. Page scripts can be run from bytecode (written without source or debug info): with [`QjsDocument::bytecode_cache`] on, each
//! external script is compiled once to `<script>.qjsc` next to it and later launches read that
//! instead of parsing.
//!
//! Covered: what react-dom 19 and Preact (with preact/compat) need for client rendering and
//! events. Not covered (unlike the Boa crate): Selection/Range, form-control state, scrolling
//! APIs, stylesheets/CSSOM, computed style, ES modules, fetch.

mod ops;

use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    rc::Rc,
    time::Instant,
};

use blitz_dom::{
    BaseDocument, DocGuard, DocGuardMut, Document, DocumentConfig, EventDriver, EventHandler,
    NodeId,
};
use blitz_traits::events::{DomEvent, DomEventData, EventState, UiEvent};
use rquickjs::{Array, CatchResultExt, Context, Ctx, Function, Object, Runtime, Value, qjs};
use url::Url;

const BOOTSTRAP_JS: &str = include_str!("bootstrap.js");
/// `bootstrap.js` compiled by build.rs (stripped of source and debug info).
const BOOTSTRAP_QJSC: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/bootstrap.qjsc"));

/// Times of the last [`QjsDocument::execute_scripts`], in milliseconds.
#[derive(Debug, Default, Clone)]
pub struct ScriptStats {
    /// Runtime + context + ops + bootstrap.js.
    pub bootstrap_ms: f64,
    /// Of `bootstrap_ms`: `Runtime::new` + `Context::full`.
    pub runtime_ms: f64,
    /// Of `bootstrap_ms`: bootstrap.js compile (or bytecode read) and its top-level run.
    pub bootstrap_js_ms: f64,
    pub bootstrap_from_bytecode: bool,
    /// Parsing and compiling source (0 when bytecode was read).
    pub compile_ms: f64,
    /// Reading bytecode (0 when compiled from source).
    pub load_bytecode_ms: f64,
    /// Running the top-level code.
    pub run_ms: f64,
    /// DOMContentLoaded/load handlers and the job queue after them (where React's first commit
    /// lands when it is scheduled from a microtask).
    pub loaded_ms: f64,
    pub bytecode_bytes: usize,
    pub from_bytecode: bool,
}

/// Reads a script URL that is not `file:` (an embedder's custom scheme).
pub type ScriptLoader = Box<dyn FnMut(&Url) -> Option<Vec<u8>>>;

pub(crate) struct Shared {
    pub doc: Rc<RefCell<BaseDocument>>,
    pub base: Option<Url>,
    /// Taken out while it runs, so a script it loads can load another.
    pub loader: Option<ScriptLoader>,
    /// Bytecode cache for loader-provided scripts (see [`QjsDocument::set_bytecode_cache_dir`]).
    pub cache_dir: Option<PathBuf>,
    pub start: Instant,
    pub errors: Vec<String>,
    pub messages: Vec<String>,
}

pub struct QjsDocument {
    inner: Rc<RefCell<BaseDocument>>,
    rt: Runtime,
    ctx: Context,
    shared: Rc<RefCell<Shared>>,
    base: Option<Url>,
    scripts_executed: bool,
    next_timer_ms: Option<f64>,
    /// When queued rAF callbacks are due (they run with the timers, but never delay a paint).
    next_frame_ms: Option<f64>,
    /// Compile external scripts to `<path>.qjsc` once and read that on later runs.
    pub bytecode_cache: bool,
    pub stats: ScriptStats,
}

/// What [`load`] did.
#[derive(Default)]
struct Loaded {
    compile_ms: f64,
    read_ms: f64,
    bytes: usize,
    from_bytecode: bool,
}

/// A global script ready to run: read from `bytecode` when this build can read it, else compiled
/// from `src()` (and, with `write_to`, written there without source or debug info).
/// Returns `None` when there is no source; the value may be an exception.
///
/// SAFETY: `raw` is a live context; the caller frees or consumes the returned value.
unsafe fn load(
    raw: *mut qjs::JSContext,
    name: &str,
    bytecode: Option<&[u8]>,
    src: impl FnOnce() -> Option<Vec<u8>>,
    write_to: Option<&Path>,
    out: &mut Loaded,
) -> Option<qjs::JSValue> {
    unsafe {
        let t = Instant::now();
        if let Some(bytes) = bytecode {
            let f = qjs::JS_ReadObject(
                raw,
                bytes.as_ptr(),
                bytes.len() as _,
                qjs::JS_READ_OBJ_BYTECODE as _,
            );
            out.read_ms += t.elapsed().as_secs_f64() * 1000.0;
            if !qjs::JS_IsException(f) {
                out.bytes += bytes.len();
                out.from_bytecode = true;
                return Some(f);
            }
            // Written by another QuickJS build: drop the exception and compile.
            qjs::JS_FreeValue(raw, qjs::JS_GetException(raw));
        }
        let t = Instant::now();
        let mut src = src()?;
        src.push(0);
        let fname = std::ffi::CString::new(name).unwrap();
        let f = qjs::JS_Eval(
            raw,
            src.as_ptr().cast(),
            (src.len() - 1) as _,
            fname.as_ptr(),
            (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_COMPILE_ONLY) as _,
        );
        out.compile_ms += t.elapsed().as_secs_f64() * 1000.0;
        if let Some(cache) = write_to
            && !qjs::JS_IsException(f)
        {
            let mut len = 0usize;
            let flags = qjs::JS_WRITE_OBJ_BYTECODE
                | qjs::JS_WRITE_OBJ_STRIP_SOURCE
                | qjs::JS_WRITE_OBJ_STRIP_DEBUG;
            let buf = qjs::JS_WriteObject(raw, (&mut len as *mut usize).cast(), f, flags as _);
            if !buf.is_null() {
                let _ = std::fs::write(cache, std::slice::from_raw_parts(buf, len));
                out.bytes += len;
                qjs::js_free(raw, buf.cast());
            }
        }
        Some(f)
    }
}

/// Runs a script from the embedder's loader: its shipped bytecode `<url>.qjsc` if the loader has
/// one this QuickJS can read (`qjs-precompile` output), else its source through [`eval_cached`].
/// `BLITZ_QJS_SHIPPED=off` skips shipped bytecode (stripped: its stacks have no file or line).
pub(crate) fn run_loader_script(
    ctx: &Ctx<'_>,
    shared: &Rc<RefCell<Shared>>,
    url: &Url,
) -> Result<(), String> {
    let fetch = |u: &Url| {
        let mut loader = shared.borrow_mut().loader.take()?;
        let bytes = loader(u);
        shared.borrow_mut().loader = Some(loader);
        bytes
    };
    let raw = ctx.as_raw().as_ptr();
    let shipped = std::env::var_os("BLITZ_QJS_SHIPPED").is_none_or(|v| v != "off");
    if let Some(bc) = Url::parse(&format!("{url}.qjsc"))
        .ok()
        .filter(|_| shipped)
        .and_then(|u| fetch(&u))
    {
        // SAFETY: raw QuickJS calls on this context; JS_EvalFunction consumes `func`.
        unsafe {
            let func = qjs::JS_ReadObject(
                raw,
                bc.as_ptr(),
                bc.len() as _,
                qjs::JS_READ_OBJ_BYTECODE as _,
            );
            if qjs::JS_IsException(func) {
                // Another QuickJS version, or not bytecode at all (an SPA fallback page).
                qjs::JS_FreeValue(raw, qjs::JS_GetException(raw));
            } else {
                let r = qjs::JS_EvalFunction(raw, func);
                if qjs::JS_IsException(r) {
                    return Err(describe(ctx, ctx.catch()));
                }
                qjs::JS_FreeValue(raw, r);
                return Ok(());
            }
        }
    }
    let src = fetch(url).ok_or_else(|| "cannot load".to_owned())?;
    let cache_dir = shared.borrow().cache_dir.clone();
    eval_cached(ctx, url.as_str(), src, cache_dir.as_deref())
}

/// Runs a script's source through the bytecode cache in `cache_dir` (none: plain eval). The key
/// hashes the name and the source, so changed bundles recompile; a cache file another QuickJS
/// build wrote fails to load and is recompiled.
pub(crate) fn eval_cached(
    ctx: &Ctx<'_>,
    name: &str,
    src: Vec<u8>,
    cache_dir: Option<&Path>,
) -> Result<(), String> {
    let Some(dir) = cache_dir else {
        return eval_named(ctx, &String::from_utf8_lossy(&src), name);
    };
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (name, &src).hash(&mut h);
    let cache = dir.join(format!("{:016x}.qjsc", h.finish()));
    let raw = ctx.as_raw().as_ptr();
    // SAFETY: raw QuickJS calls on this context, as in `run_file`.
    unsafe {
        let mut l = Loaded::default();
        let bytes = std::fs::read(&cache).ok();
        let Some(func) = load(
            raw,
            name,
            bytes.as_deref(),
            || Some(src),
            Some(cache.as_path()),
            &mut l,
        ) else {
            return Err("cannot load".into());
        };
        if qjs::JS_IsException(func) {
            return Err(describe(ctx, ctx.catch()));
        }
        let r = qjs::JS_EvalFunction(raw, func);
        if qjs::JS_IsException(r) {
            return Err(describe(ctx, ctx.catch()));
        }
        qjs::JS_FreeValue(raw, r);
    }
    Ok(())
}

/// Compiles and runs `src` as a global script named `name` (stack traces show the name); returns
/// the error text if it threw.
pub(crate) fn eval_named(ctx: &Ctx<'_>, src: &str, name: &str) -> Result<(), String> {
    let raw = ctx.as_raw().as_ptr();
    let mut src = src.as_bytes().to_vec();
    src.push(0);
    let fname = std::ffi::CString::new(name.replace('\0', "")).unwrap();
    // SAFETY: raw calls on this live context; the result is freed, an exception is taken by catch.
    unsafe {
        let r = qjs::JS_Eval(
            raw,
            src.as_ptr().cast(),
            (src.len() - 1) as _,
            fname.as_ptr(),
            qjs::JS_EVAL_TYPE_GLOBAL as _,
        );
        if qjs::JS_IsException(r) {
            return Err(describe(ctx, ctx.catch()));
        }
        qjs::JS_FreeValue(raw, r);
    }
    Ok(())
}

fn describe<'js>(ctx: &Ctx<'js>, v: Value<'js>) -> String {
    if let Some(o) = v.as_object() {
        let msg: String = o.get("message").unwrap_or_default();
        let stack: String = o.get("stack").unwrap_or_default();
        if !msg.is_empty() || !stack.is_empty() {
            return format!("{msg}\n{stack}");
        }
    }
    let _ = ctx;
    format!("{v:?}")
}

/// The clock for CSS animations and transitions, in seconds: pass it to `resolve` everywhere (a
/// constant freezes every transition at its first frame).
pub fn animation_time() -> f64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// `innerHTML` and friends parse through the document's HTML parser provider, which is a no-op
/// unless the config names one.
fn with_html_parser(mut config: DocumentConfig) -> DocumentConfig {
    config
        .html_parser_provider
        .get_or_insert_with(|| std::sync::Arc::new(blitz_html::HtmlProvider));
    config
}

impl QjsDocument {
    pub fn from_html(html: &str, config: DocumentConfig) -> Self {
        let base = config.base_url.as_deref().and_then(|u| Url::parse(u).ok());
        let doc: BaseDocument =
            blitz_html::HtmlDocument::from_html(html, with_html_parser(config)).into();
        Self::from_base_document(doc, base, false)
    }

    /// As [`Self::from_html`], but parses `bootstrap.js` instead of reading its embedded bytecode
    /// (to time the difference).
    pub fn from_html_source_bootstrap(html: &str, config: DocumentConfig) -> Self {
        let base = config.base_url.as_deref().and_then(|u| Url::parse(u).ok());
        let doc: BaseDocument =
            blitz_html::HtmlDocument::from_html(html, with_html_parser(config)).into();
        Self::from_base_document(doc, base, true)
    }

    pub fn from_base_document(
        doc: BaseDocument,
        base: Option<Url>,
        bootstrap_from_source: bool,
    ) -> Self {
        let t = Instant::now();
        let inner = Rc::new(RefCell::new(doc));
        let shared = Rc::new(RefCell::new(Shared {
            doc: inner.clone(),
            base: base.clone(),
            loader: None,
            cache_dir: None,
            start: Instant::now(),
            errors: Vec::new(),
            messages: Vec::new(),
        }));
        let rt = Runtime::new().expect("a QuickJS runtime");
        // BLITZ_QJS_INTERRUPT_MS=N: from N ms after the document is made, abort all JS (diagnostics:
        // a hang then surfaces as errors with JS stacks, even where app code catches and retries).
        if let Some(ms) = std::env::var("BLITZ_QJS_INTERRUPT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            let deadline = Instant::now() + std::time::Duration::from_millis(ms);
            rt.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
        }
        let ctx = Context::full(&rt).expect("a QuickJS context");
        // BLITZ_QJS_REJECTIONS=1: report promise rejections that have no handler when they happen
        // (diagnostics; a handler attached later still shows up here).
        if std::env::var_os("BLITZ_QJS_REJECTIONS").is_some() {
            let sh = shared.clone();
            rt.set_host_promise_rejection_tracker(Some(Box::new(
                move |ctx, _promise, reason, handled| {
                    if !handled {
                        let msg = describe(&ctx, reason);
                        sh.borrow_mut()
                            .errors
                            .push(format!("unhandled rejection: {msg}"));
                    }
                },
            )));
        }
        let mut stats = ScriptStats {
            runtime_ms: t.elapsed().as_secs_f64() * 1000.0,
            ..Default::default()
        };
        ctx.with(|ctx| {
            ops::install(&ctx, shared.clone(), base.as_ref());
            let t = Instant::now();
            let raw = ctx.as_raw().as_ptr();
            let mut l = Loaded::default();
            // SAFETY: raw calls on this context; JS_EvalFunction consumes `f`, `r` is freed.
            let failed = unsafe {
                let f = load(
                    raw,
                    "bootstrap.js",
                    (!bootstrap_from_source).then_some(BOOTSTRAP_QJSC),
                    || Some(BOOTSTRAP_JS.as_bytes().to_vec()),
                    None,
                    &mut l,
                )
                .unwrap();
                let r = if qjs::JS_IsException(f) {
                    f
                } else {
                    qjs::JS_EvalFunction(raw, f)
                };
                let failed = qjs::JS_IsException(r);
                if !failed {
                    qjs::JS_FreeValue(raw, r);
                }
                failed
            };
            if failed {
                let e = describe(&ctx, ctx.catch());
                shared.borrow_mut().errors.push(format!("bootstrap: {e}"));
            }
            stats.bootstrap_js_ms = t.elapsed().as_secs_f64() * 1000.0;
            stats.bootstrap_from_bytecode = l.from_bytecode;
        });
        let mut d = QjsDocument {
            inner,
            rt,
            ctx,
            shared,
            base,
            scripts_executed: false,
            next_timer_ms: None,
            next_frame_ms: None,
            bytecode_cache: false,
            stats,
        };
        d.run_jobs();
        d.stats.bootstrap_ms = t.elapsed().as_secs_f64() * 1000.0;
        d
    }

    /// Where `<script src>` URLs that are not `file:` are read from (parse-time and inserted scripts).
    pub fn set_script_loader(&mut self, loader: ScriptLoader) {
        self.shared.borrow_mut().loader = Some(loader);
    }

    /// Scripts from the loader (parse-time `src` and runtime-inserted ones) run from stripped
    /// bytecode cached in `dir`, keyed by URL + source hash, compiled on first use.
    pub fn set_bytecode_cache_dir(&mut self, dir: Option<PathBuf>) {
        if let Some(d) = &dir {
            let _ = std::fs::create_dir_all(d);
        }
        self.shared.borrow_mut().cache_dir = dir;
    }

    /// The QuickJS context, for an embedder to install its own globals.
    pub fn context(&self) -> &Context {
        &self.ctx
    }

    /// Runs pending promise jobs (microtasks).
    pub fn run_jobs(&mut self) {
        self.drain_jobs();
        // Jobs may have added timers (React's scheduler, from an IPC response): without this the
        // cached next deadline stays on an older, later timer and the new one waits for it.
        self.refresh_timers();
    }

    fn drain_jobs(&mut self) {
        loop {
            match self.rt.execute_pending_job() {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    let msg = e.0.with(|ctx| describe(&ctx, ctx.catch()));
                    self.shared.borrow_mut().errors.push(format!("job: {msg}"));
                }
            }
        }
    }

    /// Runs the `<script>` elements in document order (inline and `src` with file: URLs).
    pub fn execute_scripts(&mut self) {
        if self.scripts_executed {
            return;
        }
        self.scripts_executed = true;
        let scripts: Vec<(NodeId, bool, Option<String>, String)> = {
            let doc = self.inner.borrow();
            let mut out = Vec::new();
            let mut stack = vec![doc.root_node().id];
            while let Some(id) = stack.pop() {
                let Some(node) = doc.get_node(id) else {
                    continue;
                };
                if let Some(el) = node.element_data()
                    && &*el.name.local == "script"
                {
                    let ty = el
                        .attr(blitz_dom::local_name!("type"))
                        .unwrap_or("")
                        .trim()
                        .to_ascii_lowercase();
                    let js = [
                        "",
                        "text/javascript",
                        "application/javascript",
                        "text/ecmascript",
                        "application/ecmascript",
                        "module",
                    ]
                    .contains(&ty.as_str());
                    out.push((
                        id,
                        js,
                        el.attr(blitz_dom::local_name!("src")).map(str::to_owned),
                        node.text_content(),
                    ));
                    continue;
                }
                stack.extend(node.children.iter().rev().copied());
            }
            out
        };
        for (id, js, src, inline) in scripts {
            if !js {
                continue;
            }
            self.call_global("__blitzCurrentScript", (id.as_u64() as f64,));
            // BLITZ_QJS_TRACE=1: each parse-time script's start and duration on stderr.
            let trace = std::env::var_os("BLITZ_QJS_TRACE").map(|_| {
                (
                    Instant::now(),
                    src.clone()
                        .unwrap_or_else(|| format!("<inline {} bytes>", inline.len())),
                )
            });
            if let Some((_, what)) = &trace {
                eprintln!("qjs script start: {what}");
            }
            match src {
                Some(src) => {
                    let url = self.base.as_ref().and_then(|b| b.join(&src).ok());
                    if let Some(url) = url.filter(|u| u.scheme() != "file")
                        && self.shared.borrow().loader.is_some()
                    {
                        let (t, shared) = (Instant::now(), self.shared.clone());
                        self.ctx.with(|ctx| {
                            if let Err(e) = run_loader_script(&ctx, &shared, &url) {
                                shared.borrow_mut().errors.push(format!("{url}: {e}"));
                            }
                        });
                        self.stats.run_ms += t.elapsed().as_secs_f64() * 1000.0;
                        self.run_jobs();
                        continue;
                    }
                    let path = self
                        .base
                        .as_ref()
                        .and_then(|b| b.join(&src).ok())
                        .and_then(|u| u.to_file_path().ok())
                        .unwrap_or_else(|| PathBuf::from(&src));
                    self.run_file(&path);
                }
                None => self.eval_source(&inline, "<inline>"),
            }
            if let Some((t, what)) = trace {
                eprintln!(
                    "qjs script done: {what} in {:.0} ms",
                    t.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
        self.call_global("__blitzCurrentScript", (-1.0,));
        let t = Instant::now();
        self.call_global("__blitzLoaded", ());
        self.run_jobs();
        self.stats.loaded_ms = t.elapsed().as_secs_f64() * 1000.0;
    }

    /// Runs `src` as a global script, then the microtasks it queued.
    pub fn eval(&mut self, src: &str, name: &str) {
        self.eval_source(src, name);
        self.refresh_timers();
    }

    fn eval_source(&mut self, src: &str, name: &str) {
        let t = Instant::now();
        let shared = self.shared.clone();
        self.ctx.with(|ctx| {
            if let Err(e) = eval_named(&ctx, src, name) {
                shared.borrow_mut().errors.push(format!("{name}: {e}"));
            }
        });
        // Parse, compile and run are one step here.
        self.stats.run_ms += t.elapsed().as_secs_f64() * 1000.0;
        self.run_jobs();
    }

    fn run_file(&mut self, path: &Path) {
        let cache = PathBuf::from(format!("{}.qjsc", path.display()));
        let name = path.display().to_string();
        let shared = self.shared.clone();
        let stats = &mut self.stats;
        let use_cache = self.bytecode_cache;
        self.ctx.with(|ctx| {
            let raw = ctx.as_raw().as_ptr();
            let report = |what: &str| {
                let e = describe(&ctx, ctx.catch());
                shared
                    .borrow_mut()
                    .errors
                    .push(format!("{name} ({what}): {e}"));
            };
            // SAFETY: raw QuickJS calls on this context; every JSValue made here is freed or
            // consumed (JS_EvalFunction frees its argument).
            unsafe {
                let mut l = Loaded::default();
                let read_src = || std::fs::read(path).ok();
                let bytes = if use_cache {
                    std::fs::read(&cache).ok()
                } else {
                    None
                };
                let Some(func) = load(
                    raw,
                    &name,
                    bytes.as_deref(),
                    read_src,
                    use_cache.then_some(cache.as_path()),
                    &mut l,
                ) else {
                    shared
                        .borrow_mut()
                        .errors
                        .push(format!("cannot read {name}"));
                    return;
                };
                stats.compile_ms += l.compile_ms;
                stats.load_bytecode_ms += l.read_ms;
                stats.bytecode_bytes += l.bytes;
                stats.from_bytecode |= l.from_bytecode;
                if qjs::JS_IsException(func) {
                    report("compile");
                    return;
                }
                let t = Instant::now();
                let r = qjs::JS_EvalFunction(raw, func);
                stats.run_ms += t.elapsed().as_secs_f64() * 1000.0;
                if qjs::JS_IsException(r) {
                    report("run");
                } else {
                    qjs::JS_FreeValue(raw, r);
                }
            }
        });
        self.run_jobs();
    }

    pub fn call_global<A: for<'js> rquickjs::function::IntoArgs<'js>>(
        &mut self,
        name: &str,
        args: A,
    ) -> Option<f64> {
        let shared = self.shared.clone();
        let out = self.ctx.with(|ctx| {
            let f: Function = ctx.globals().get(name).ok()?;
            match f.call::<_, Value>(args).catch(&ctx) {
                Ok(v) => v.as_number(),
                Err(e) => {
                    shared.borrow_mut().errors.push(format!("{name}: {e}"));
                    None
                }
            }
        });
        self.drain_jobs();
        out
    }

    /// Runs due timers and rAF callbacks; returns whether any ran.
    pub fn run_due_timers(&mut self) -> bool {
        let now = self.shared.borrow().start.elapsed().as_secs_f64() * 1000.0;
        let next = self.next_wake_ms();
        if next.is_some_and(|t| t > now) {
            return false;
        }
        self.call_global("__blitzTimers", (now,));
        // After the timers' promise jobs, which may have added timers of their own.
        self.refresh_timers();
        next.is_some()
    }

    fn next_wake_ms(&self) -> Option<f64> {
        [self.next_timer_ms, self.next_frame_ms]
            .into_iter()
            .flatten()
            .reduce(f64::min)
    }

    fn deadline(&self, ms: Option<f64>) -> Option<Instant> {
        let start = self.shared.borrow().start;
        ms.map(|ms| start + std::time::Duration::from_secs_f64(ms / 1000.0))
    }

    /// When the next JS timer is due (rAF callbacks excluded).
    pub fn next_timer_deadline(&self) -> Option<Instant> {
        self.deadline(self.next_timer_ms)
    }

    /// When the loop must wake for this document: the next timer or rAF frame.
    pub fn next_wake_deadline(&self) -> Option<Instant> {
        self.deadline(self.next_wake_ms())
    }

    pub fn take_js_errors(&mut self) -> Vec<String> {
        std::mem::take(&mut self.shared.borrow_mut().errors)
    }

    pub fn take_messages(&mut self) -> Vec<String> {
        std::mem::take(&mut self.shared.borrow_mut().messages)
    }

    /// QuickJS heap use: (malloc'd bytes, objects).
    pub fn js_memory(&self) -> (i64, i64) {
        let m = self.rt.memory_usage();
        (m.malloc_size, m.obj_count)
    }

    fn refresh_timers(&mut self) {
        let next = self.call_global("__blitzNextTimer", ()).unwrap_or(-1.0);
        self.next_timer_ms = (next >= 0.0).then_some(next);
        let frame = self.call_global("__blitzNextFrame", ()).unwrap_or(-1.0);
        self.next_frame_ms = (frame >= 0.0).then_some(frame);
    }
}

/// Builds the init dictionary of a DOM event from Blitz's event data.
fn event_init<'js>(ctx: &Ctx<'js>, data: &DomEventData) -> rquickjs::Result<Object<'js>> {
    let o = Object::new(ctx.clone())?;
    use DomEventData as D;
    match data {
        D::PointerMove(p)
        | D::PointerDown(p)
        | D::PointerUp(p)
        | D::PointerCancel(p)
        | D::PointerEnter(p)
        | D::PointerLeave(p)
        | D::PointerOver(p)
        | D::PointerOut(p)
        | D::MouseMove(p)
        | D::MouseDown(p)
        | D::MouseUp(p)
        | D::MouseEnter(p)
        | D::MouseLeave(p)
        | D::MouseOver(p)
        | D::MouseOut(p)
        | D::TouchStart(p)
        | D::TouchMove(p)
        | D::TouchEnd(p)
        | D::TouchCancel(p)
        | D::Click(p)
        | D::ContextMenu(p)
        | D::DoubleClick(p) => {
            o.set("kind", "pointer")?;
            o.set("clientX", p.coords.client_x)?;
            o.set("clientY", p.coords.client_y)?;
            o.set("pageX", p.coords.page_x)?;
            o.set("pageY", p.coords.page_y)?;
            o.set("screenX", p.coords.screen_x)?;
            o.set("screenY", p.coords.screen_y)?;
            o.set("button", p.button as i32 - 1)?;
            o.set("buttons", p.buttons.bits())?;
            o.set("isPrimary", p.is_primary)?;
            o.set(
                "pointerType",
                match p.id {
                    blitz_traits::events::BlitzPointerId::Mouse => "mouse",
                    blitz_traits::events::BlitzPointerId::Pen => "pen",
                    blitz_traits::events::BlitzPointerId::Finger(_) => "touch",
                },
            )?;
        }
        D::KeyDown(k) | D::KeyUp(k) | D::KeyPress(k) => {
            o.set("kind", "key")?;
            o.set("key", k.key.to_string())?;
            o.set("code", k.code.to_string())?;
            o.set("repeat", k.is_auto_repeating)?;
        }
        D::Input(i) => {
            o.set("kind", "input")?;
            o.set("value", i.value.clone())?;
        }
        _ => {
            o.set("kind", "event")?;
        }
    }
    Ok(o)
}

struct JsEvents<'a> {
    ctx: &'a Context,
    shared: Rc<RefCell<Shared>>,
}

impl EventHandler for JsEvents<'_> {
    fn handle_event(
        &mut self,
        chain: &[NodeId],
        event: &mut DomEvent,
        _doc: &mut dyn Document,
        state: &mut EventState,
    ) {
        let shared = self.shared.clone();
        let flags = self.ctx.with(|ctx| -> Option<i32> {
            let f: Function = ctx.globals().get("__blitzDispatch").ok()?;
            let ids = Array::new(ctx.clone()).ok()?;
            for (i, id) in chain.iter().enumerate() {
                ids.set(i, id.as_u64() as f64).ok()?;
            }
            let init = event_init(&ctx, &event.data).ok()?;
            match f
                .call::<_, i32>((ids, event.name(), event.bubbles, event.cancelable, init))
                .catch(&ctx)
            {
                Ok(v) => Some(v),
                Err(e) => {
                    shared
                        .borrow_mut()
                        .errors
                        .push(format!("dispatch {}: {e}", event.name()));
                    None
                }
            }
        });
        let flags = flags.unwrap_or(0);
        if flags & 1 != 0 {
            state.prevent_default();
        }
        if flags & 2 != 0 {
            state.stop_propagation();
        }
        if flags & 4 != 0 {
            state.request_redraw();
        }
    }
}

impl Document for QjsDocument {
    fn inner(&self) -> DocGuard<'_> {
        DocGuard::RefCell(self.inner.borrow())
    }

    fn inner_mut(&mut self) -> DocGuardMut<'_> {
        DocGuardMut::RefCell(self.inner.borrow_mut())
    }

    fn handle_ui_event(&mut self, event: UiEvent) {
        let handler = JsEvents {
            ctx: &self.ctx,
            shared: self.shared.clone(),
        };
        let mut driver = EventDriver::new(&mut self.inner, handler);
        driver.handle_ui_event(event);
        self.run_jobs();
        self.refresh_timers();
    }

    fn poll(&mut self, _cx: Option<std::task::Context<'_>>) -> bool {
        if !self.scripts_executed {
            self.execute_scripts();
            self.refresh_timers();
            return true;
        }
        self.run_due_timers()
    }
}
