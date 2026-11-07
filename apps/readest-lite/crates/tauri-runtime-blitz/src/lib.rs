// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! A Tauri runtime whose webview is Blitz + QuickJS (see `webview.rs`). Started from tauri's
//! `MockRuntime` (crates/tauri/src/test/mock_runtime.rs, Apache-2.0 OR MIT): the window side stays
//! mostly stubbed (one headless window), the webview and the event loop are real.
#![allow(dead_code)]
#![allow(missing_docs)]
#![allow(unused_variables)]

#[cfg(feature = "window")]
mod display;
mod fonts;
mod webview;

use tauri_runtime::{
    DeviceEventFilter, Error, EventLoopProxy, ExitRequestedEventAction, Icon, ProgressBarState,
    Result, RunEvent, Runtime, RuntimeHandle, RuntimeInitArgs, RuntimeInitAttrs, UserAttentionType,
    UserEvent, WebviewDispatch, WindowDispatch, WindowEventId,
    dpi::{PhysicalPosition, PhysicalSize, Position, Size},
    monitor::Monitor,
    webview::{DetachedWebview, PendingWebview},
    window::{
        CursorIcon, DetachedWindow, DetachedWindowWebview, PendingWindow, RawWindow, WindowBuilder,
        WindowBuilderBase, WindowEvent, WindowId,
    },
};

#[cfg(target_os = "macos")]
use tauri_utils::TitleBarStyle;
use tauri_utils::{Theme, config::WindowConfig};
use url::Url;

#[cfg(windows)]
use windows::Win32::Foundation::HWND;

use std::{
    any::Any,
    borrow::Cow,
    cell::RefCell,
    collections::HashMap,
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{Receiver, RecvTimeoutError, Sender, channel},
    },
    time::{Duration, Instant},
};

type ShortcutMap = HashMap<String, Box<dyn Fn() + Send + 'static>>;

pub(crate) enum Message {
    Task(Box<dyn FnOnce() + Send>),
    CloseWindow(WindowId),
    DestroyWindow(WindowId),
    /// `eval_script` for a webview id.
    Eval {
        webview: u32,
        script: String,
    },
    /// A custom-scheme handler answered the page's `fetch` number `id`.
    FetchDone {
        webview: u32,
        id: u32,
        response: http::Response<Cow<'static, [u8]>>,
    },
    Navigate {
        webview: u32,
        url: String,
    },
    /// Pointer input from the display window, in device pixels.
    #[cfg_attr(not(feature = "window"), allow(dead_code))]
    Pointer {
        webview: u32,
        x: f32,
        y: f32,
        down: bool,
    },
    /// An `EventLoopProxy` user event; the loop downcasts it to its `T`.
    UserEvent(Box<dyn Any + Send>),
    Exit(i32),
}

struct Window {
    label: String,
    webviews: Vec<webview::BlitzWebview>,
    /// Shared with the window's webviews: hidden ones paint nothing (`"visible": false` + `show()`).
    visible: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct RuntimeContext {
    is_running: Arc<AtomicBool>,
    windows: Arc<RefCell<HashMap<WindowId, Window>>>,
    shortcuts: Arc<Mutex<ShortcutMap>>,
    run_tx: Sender<Message>,
    main_thread_id: std::thread::ThreadId,
    next_window_id: Arc<AtomicU32>,
    next_webview_id: Arc<AtomicU32>,
    next_window_event_id: Arc<AtomicU32>,
    next_webview_event_id: Arc<AtomicU32>,
}

// SAFETY: we ensure this type is only used on the main thread.
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for RuntimeContext {}

// SAFETY: we ensure this type is only used on the main thread.
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Sync for RuntimeContext {}

impl RuntimeContext {
    /// Tasks posted from the main thread run at once; everything else is queued for the loop (also
    /// before it starts: an `eval_script` during setup runs after the page loads).
    fn send_message(&self, message: Message) -> Result<()> {
        if std::thread::current().id() == self.main_thread_id
            && let Message::Task(task) = message
        {
            task();
            return Ok(());
        }
        self.run_tx
            .send(message)
            .map_err(|_| Error::FailedToSendMessage)
    }

    fn create_window<T: UserEvent>(
        &self,
        pending: PendingWindow<T, BlitzRuntime>,
    ) -> Result<DetachedWindow<T, BlitzRuntime>> {
        let id = self.next_window_id();
        let visible = Arc::new(AtomicBool::new(pending.window_builder.visible));
        self.windows.borrow_mut().insert(
            id,
            Window {
                label: pending.label.clone(),
                webviews: Vec::new(),
                visible: visible.clone(),
            },
        );
        let webview = match pending.webview {
            Some(w) => {
                let devtools = w.webview_attributes.devtools;
                Some(DetachedWindowWebview {
                    webview: self.create_webview(id, w)?,
                    use_https_scheme: false,
                    devtools,
                })
            }
            None => None,
        };
        Ok(DetachedWindow {
            id,
            label: pending.label,
            dispatcher: BlitzWindowDispatcher {
                id,
                context: self.clone(),
                visible,
            },
            webview,
        })
    }

    /// Builds the Blitz webview on the main thread; its first navigation is queued for the loop.
    fn create_webview<T: UserEvent>(
        &self,
        window_id: WindowId,
        pending: PendingWebview<T, BlitzRuntime>,
    ) -> Result<DetachedWebview<T, BlitzRuntime>> {
        if std::thread::current().id() != self.main_thread_id {
            // The document and its JS context are not Send; creating webviews from other threads would
            // need a round trip to the loop (not implemented).
            return Err(Error::CreateWebview(
                "tauri-runtime-blitz creates webviews on the main thread only".into(),
            ));
        }
        let id = self.next_webview_id();
        let url = Arc::new(Mutex::new(pending.url.clone()));
        let dispatcher = BlitzWebviewDispatcher {
            id,
            context: self.clone(),
            url: url.clone(),
            last_evaluated_script: Default::default(),
        };
        let ipc = pending.ipc_handler.map(|h| {
            let detached = DetachedWebview {
                label: pending.label.clone(),
                dispatcher: dispatcher.clone(),
            };
            Box::new(move |req: http::Request<String>| h(detached.clone(), req))
                as webview::IpcHandler
        });
        let page_load = pending
            .on_page_load_handler
            .map(|h| Box::new(move |url: Url, event| h(url, event)) as webview::PageLoadHandler);
        let wv = webview::BlitzWebview::new(webview::WebviewInit {
            id,
            label: pending.label.clone(),
            url,
            protocols: Arc::new(pending.uri_scheme_protocols),
            ipc,
            init_scripts: pending.webview_attributes.initialization_scripts,
            page_load,
            tx: self.run_tx.clone(),
        });
        if let Some(w) = self.windows.borrow_mut().get_mut(&window_id) {
            let mut wv = wv;
            wv.visible = w.visible.clone();
            w.webviews.push(wv);
        }
        self.run_tx
            .send(Message::Navigate {
                webview: id,
                url: pending.url,
            })
            .map_err(|_| Error::FailedToSendMessage)?;
        Ok(DetachedWebview {
            label: pending.label,
            dispatcher,
        })
    }

    fn next_window_id(&self) -> WindowId {
        self.next_window_id.fetch_add(1, Ordering::Relaxed).into()
    }

    fn next_webview_id(&self) -> u32 {
        self.next_webview_id.fetch_add(1, Ordering::Relaxed)
    }

    fn next_window_event_id(&self) -> WindowEventId {
        self.next_window_event_id.fetch_add(1, Ordering::Relaxed)
    }

    fn next_webview_event_id(&self) -> WindowEventId {
        self.next_webview_event_id.fetch_add(1, Ordering::Relaxed)
    }
}

impl fmt::Debug for RuntimeContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeContext").finish()
    }
}

#[derive(Debug, Clone)]
pub struct BlitzRuntimeHandle {
    context: RuntimeContext,
}

impl<T: UserEvent> RuntimeHandle<T> for BlitzRuntimeHandle {
    type Runtime = BlitzRuntime;

    fn create_proxy(&self) -> EventProxy {
        EventProxy {
            tx: self.context.run_tx.clone(),
        }
    }

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn set_activation_policy(
        &self,
        activation_policy: tauri_runtime::ActivationPolicy,
    ) -> Result<()> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn set_dock_visibility(&self, visible: bool) -> Result<()> {
        Ok(())
    }

    fn request_exit(&self, code: i32) -> Result<()> {
        self.context.send_message(Message::Exit(code))
    }

    fn custom_scheme_url(&self, scheme: &str, _https: bool) -> String {
        format!("{scheme}://localhost")
    }

    fn webview_version(&self) -> Result<String> {
        Ok("0.0.0".into())
    }

    /// Create a new webview window.
    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &self,
        pending: PendingWindow<T, Self::Runtime>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self::Runtime>> {
        self.context.create_window(pending)
    }

    fn create_webview(
        &self,
        window_id: WindowId,
        pending: PendingWebview<T, Self::Runtime>,
    ) -> Result<DetachedWebview<T, Self::Runtime>> {
        self.context.create_webview(window_id, pending)
    }

    /// Run a task on the main thread.
    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.send_message(Message::Task(Box::new(f)))
    }

    fn display_handle(
        &self,
    ) -> std::result::Result<raw_window_handle::DisplayHandle<'_>, raw_window_handle::HandleError>
    {
        #[cfg(target_os = "linux")]
        return Ok(unsafe {
            raw_window_handle::DisplayHandle::borrow_raw(raw_window_handle::RawDisplayHandle::Xlib(
                raw_window_handle::XlibDisplayHandle::new(None, 0),
            ))
        });
        #[cfg(target_os = "macos")]
        return Ok(unsafe {
            raw_window_handle::DisplayHandle::borrow_raw(
                raw_window_handle::RawDisplayHandle::AppKit(
                    raw_window_handle::AppKitDisplayHandle::new(),
                ),
            )
        });
        #[cfg(windows)]
        return Ok(unsafe {
            raw_window_handle::DisplayHandle::borrow_raw(
                raw_window_handle::RawDisplayHandle::Windows(
                    raw_window_handle::WindowsDisplayHandle::new(),
                ),
            )
        });
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        unimplemented!();
    }

    fn primary_monitor(&self) -> Result<Option<Monitor>> {
        Ok(None)
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Result<Option<Monitor>> {
        Ok(None)
    }

    fn available_monitors(&self) -> Result<Vec<Monitor>> {
        Ok(Vec::new())
    }

    fn set_theme(&self, theme: Option<Theme>) {
        // no-op
    }

    /// Shows the application, but does not automatically focus it.
    #[cfg(target_os = "macos")]
    fn show(&self) -> Result<()> {
        Ok(())
    }

    /// Hides the application.
    #[cfg(target_os = "macos")]
    fn hide(&self) -> Result<()> {
        Ok(())
    }

    fn set_device_event_filter(&self, _: DeviceEventFilter) {
        // no-op
    }

    #[cfg(target_os = "android")]
    fn find_class<'a>(
        &self,
        env: &mut jni::JNIEnv<'a>,
        activity: &jni::objects::JObject<'_>,
        name: impl Into<String>,
    ) -> std::result::Result<jni::objects::JClass<'a>, jni::errors::Error> {
        todo!()
    }

    #[cfg(target_os = "android")]
    fn run_on_android_context<F>(&self, f: F)
    where
        F: FnOnce(&mut jni::JNIEnv<'_>, &jni::objects::JObject<'_>, &jni::objects::JObject<'_>)
            + Send
            + 'static,
    {
        todo!()
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn fetch_data_store_identifiers<F: FnOnce(Vec<[u8; 16]>) + Send + 'static>(
        &self,
        cb: F,
    ) -> Result<()> {
        todo!()
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn remove_data_store<F: FnOnce(Result<()>) + Send + 'static>(
        &self,
        uuid: [u8; 16],
        cb: F,
    ) -> Result<()> {
        todo!()
    }

    fn cursor_position(&self) -> Result<PhysicalPosition<f64>> {
        Ok(PhysicalPosition::new(0.0, 0.0))
    }
}

#[derive(Debug, Clone)]
pub struct BlitzWebviewDispatcher {
    id: u32,
    context: RuntimeContext,
    url: Arc<Mutex<String>>,
    last_evaluated_script: Arc<Mutex<Option<String>>>,
}

impl BlitzWebviewDispatcher {
    pub fn last_evaluated_script(&self) -> Option<String> {
        self.last_evaluated_script.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone)]
pub struct BlitzWindowDispatcher {
    id: WindowId,
    context: RuntimeContext,
    /// The window's visibility flag. Set directly, not through `windows`: commands run while the
    /// loop holds `windows` borrowed.
    visible: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
pub struct BlitzWindowBuilder {
    visible: bool,
}

impl WindowBuilderBase for BlitzWindowBuilder {}

impl WindowBuilder for BlitzWindowBuilder {
    fn new() -> Self {
        Self { visible: true }
    }

    fn with_config(config: &WindowConfig) -> Self {
        Self {
            visible: config.visible,
        }
    }

    fn center(self) -> Self {
        self
    }

    fn position(self, x: f64, y: f64) -> Self {
        self
    }

    fn inner_size(self, min_width: f64, min_height: f64) -> Self {
        self
    }

    fn min_inner_size(self, min_width: f64, min_height: f64) -> Self {
        self
    }

    fn max_inner_size(self, max_width: f64, max_height: f64) -> Self {
        self
    }

    fn inner_size_constraints(
        self,
        constraints: tauri_runtime::window::WindowSizeConstraints,
    ) -> Self {
        self
    }

    fn prevent_overflow(self) -> Self {
        self
    }

    fn prevent_overflow_with_margin(self, margin: tauri_runtime::dpi::Size) -> Self {
        self
    }

    fn resizable(self, resizable: bool) -> Self {
        self
    }

    fn maximizable(self, resizable: bool) -> Self {
        self
    }

    fn minimizable(self, resizable: bool) -> Self {
        self
    }

    fn closable(self, resizable: bool) -> Self {
        self
    }

    fn title<S: Into<String>>(self, title: S) -> Self {
        self
    }

    fn fullscreen(self, fullscreen: bool) -> Self {
        self
    }

    fn focused(self, focused: bool) -> Self {
        self
    }

    fn focusable(self, focusable: bool) -> Self {
        self
    }

    fn maximized(self, maximized: bool) -> Self {
        self
    }

    fn visible(self, visible: bool) -> Self {
        Self { visible }
    }

    #[cfg(any(not(target_os = "macos"), feature = "macos-private-api"))]
    #[cfg_attr(
        docsrs,
        doc(cfg(any(not(target_os = "macos"), feature = "macos-private-api")))
    )]
    fn transparent(self, transparent: bool) -> Self {
        self
    }

    fn decorations(self, decorations: bool) -> Self {
        self
    }

    fn always_on_bottom(self, always_on_bottom: bool) -> Self {
        self
    }

    fn always_on_top(self, always_on_top: bool) -> Self {
        self
    }

    fn visible_on_all_workspaces(self, visible_on_all_workspaces: bool) -> Self {
        self
    }

    fn content_protected(self, protected: bool) -> Self {
        self
    }

    fn icon(self, icon: Icon<'_>) -> Result<Self> {
        Ok(self)
    }

    fn skip_taskbar(self, skip: bool) -> Self {
        self
    }

    fn window_classname<S: Into<String>>(self, classname: S) -> Self {
        self
    }

    fn no_redirection_bitmap(self, enable: bool) -> Self {
        self
    }

    fn shadow(self, enable: bool) -> Self {
        self
    }

    #[cfg(windows)]
    fn owner(self, owner: HWND) -> Self {
        self
    }

    #[cfg(windows)]
    fn parent(self, parent: HWND) -> Self {
        self
    }

    #[cfg(target_os = "macos")]
    fn parent(self, parent: *mut std::ffi::c_void) -> Self {
        self
    }

    #[cfg(all(
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ),
        feature = "gtk"
    ))]
    fn transient_for(self, parent: &impl gtk::glib::IsA<gtk::Window>) -> Self {
        self
    }

    #[cfg(windows)]
    fn drag_and_drop(self, enabled: bool) -> Self {
        self
    }

    #[cfg(target_os = "macos")]
    fn title_bar_style(self, style: TitleBarStyle) -> Self {
        self
    }

    #[cfg(target_os = "macos")]
    fn traffic_light_position<P: Into<Position>>(self, position: P) -> Self {
        self
    }

    #[cfg(target_os = "macos")]
    fn hidden_title(self, transparent: bool) -> Self {
        self
    }

    #[cfg(target_os = "macos")]
    fn tabbing_identifier(self, identifier: &str) -> Self {
        self
    }

    fn theme(self, theme: Option<Theme>) -> Self {
        self
    }

    fn has_icon(&self) -> bool {
        false
    }

    fn get_theme(&self) -> Option<Theme> {
        None
    }

    fn background_color(self, _color: tauri_utils::config::Color) -> Self {
        self
    }

    #[cfg(target_os = "android")]
    fn activity_name<S: Into<String>>(self, _class_name: S) -> Self {
        self
    }

    #[cfg(target_os = "android")]
    fn created_by_activity_name<S: Into<String>>(self, _class_name: S) -> Self {
        self
    }

    #[cfg(target_os = "ios")]
    fn requested_by_scene_identifier<S: Into<String>>(self, _identifier: S) -> Self {
        self
    }
}

impl<T: UserEvent> WebviewDispatch<T> for BlitzWebviewDispatcher {
    type Runtime = BlitzRuntime;

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.send_message(Message::Task(Box::new(f)))
    }

    fn on_webview_event<F: Fn(&tauri_runtime::window::WebviewEvent) + Send + 'static>(
        &self,
        f: F,
    ) -> tauri_runtime::WebviewEventId {
        self.context.next_window_event_id()
    }

    fn with_webview<F: FnOnce(()) + Send + 'static>(&self, _f: F) -> Result<()> {
        Ok(())
    }

    #[cfg(target_os = "ios")]
    fn with_ios_webview<F: FnOnce(tauri_runtime::webview::IosWebviewHandle) + Send + 'static>(
        &self,
        _f: F,
    ) -> Result<()> {
        Ok(())
    }

    fn open_devtools(&self) {}

    fn close_devtools(&self) {}

    fn is_devtools_open(&self) -> Result<bool> {
        Ok(false)
    }

    fn set_zoom(&self, scale_factor: f64) -> Result<()> {
        Ok(())
    }

    fn eval_script<S: Into<String>>(&self, script: S) -> Result<()> {
        self.context.send_message(Message::Eval {
            webview: self.id,
            script: script.into(),
        })
    }

    fn eval_script_with_callback<S: Into<String>>(
        &self,
        script: S,
        callback: impl Fn(String) + Send + 'static,
    ) -> Result<()> {
        self.last_evaluated_script
            .lock()
            .unwrap()
            .replace(script.into());
        Ok(())
    }

    fn url(&self) -> Result<String> {
        Ok(self.url.lock().unwrap().clone())
    }

    fn bounds(&self) -> Result<tauri_runtime::dpi::Rect> {
        Ok(tauri_runtime::dpi::Rect::default())
    }

    fn position(&self) -> Result<PhysicalPosition<i32>> {
        Ok(PhysicalPosition { x: 0, y: 0 })
    }

    fn size(&self) -> Result<PhysicalSize<u32>> {
        Ok(PhysicalSize {
            width: 0,
            height: 0,
        })
    }

    fn navigate(&self, url: Url) -> Result<()> {
        self.context.send_message(Message::Navigate {
            webview: self.id,
            url: url.to_string(),
        })
    }

    fn reload(&self) -> Result<()> {
        Ok(())
    }

    fn go_back(&self) -> Result<()> {
        Ok(())
    }

    fn can_go_back(&self) -> Result<bool> {
        Ok(false)
    }

    fn go_forward(&self) -> Result<()> {
        Ok(())
    }

    fn can_go_forward(&self) -> Result<bool> {
        Ok(false)
    }

    fn print(&self) -> Result<()> {
        Ok(())
    }

    fn close(&self) -> Result<()> {
        Ok(())
    }

    fn set_bounds(&self, bounds: tauri_runtime::dpi::Rect) -> Result<()> {
        Ok(())
    }

    fn set_size(&self, _size: Size) -> Result<()> {
        Ok(())
    }

    fn set_position(&self, _position: Position) -> Result<()> {
        Ok(())
    }

    fn set_focus(&self) -> Result<()> {
        Ok(())
    }

    fn reparent(&self, window_id: WindowId) -> Result<()> {
        Ok(())
    }

    fn cookies(&self) -> Result<Vec<tauri_runtime::Cookie<'static>>> {
        Ok(Vec::new())
    }

    fn cookies_for_url(&self, url: Url) -> Result<Vec<tauri_runtime::Cookie<'static>>> {
        Ok(Vec::new())
    }

    fn set_cookie(&self, cookie: tauri_runtime::Cookie<'_>) -> Result<()> {
        Ok(())
    }

    fn delete_cookie(&self, cookie: tauri_runtime::Cookie<'_>) -> Result<()> {
        Ok(())
    }

    fn set_auto_resize(&self, auto_resize: bool) -> Result<()> {
        Ok(())
    }

    fn clear_all_browsing_data(&self) -> Result<()> {
        Ok(())
    }

    fn hide(&self) -> Result<()> {
        Ok(())
    }

    fn show(&self) -> Result<()> {
        Ok(())
    }

    fn set_background_color(&self, color: Option<tauri_utils::config::Color>) -> Result<()> {
        Ok(())
    }
}

impl<T: UserEvent> WindowDispatch<T> for BlitzWindowDispatcher {
    type Runtime = BlitzRuntime;

    type WindowBuilder = BlitzWindowBuilder;

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.send_message(Message::Task(Box::new(f)))
    }

    fn on_window_event<F: Fn(&WindowEvent) + Send + 'static>(&self, f: F) -> WindowEventId {
        self.context.next_window_event_id()
    }

    fn scale_factor(&self) -> Result<f64> {
        Ok(1.0)
    }

    fn inner_position(&self) -> Result<PhysicalPosition<i32>> {
        Ok(PhysicalPosition { x: 0, y: 0 })
    }

    fn outer_position(&self) -> Result<PhysicalPosition<i32>> {
        Ok(PhysicalPosition { x: 0, y: 0 })
    }

    fn inner_size(&self) -> Result<PhysicalSize<u32>> {
        Ok(PhysicalSize {
            width: 0,
            height: 0,
        })
    }

    fn outer_size(&self) -> Result<PhysicalSize<u32>> {
        Ok(PhysicalSize {
            width: 0,
            height: 0,
        })
    }

    fn is_fullscreen(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_minimized(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_maximized(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_focused(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_decorated(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_resizable(&self) -> Result<bool> {
        Ok(false)
    }

    fn is_maximizable(&self) -> Result<bool> {
        Ok(true)
    }

    fn is_minimizable(&self) -> Result<bool> {
        Ok(true)
    }

    fn is_closable(&self) -> Result<bool> {
        Ok(true)
    }

    fn is_visible(&self) -> Result<bool> {
        Ok(self.visible.load(Ordering::Relaxed))
    }

    fn title(&self) -> Result<String> {
        Ok(String::new())
    }

    fn current_monitor(&self) -> Result<Option<Monitor>> {
        Ok(None)
    }

    fn primary_monitor(&self) -> Result<Option<Monitor>> {
        Ok(None)
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Result<Option<Monitor>> {
        Ok(None)
    }

    fn available_monitors(&self) -> Result<Vec<Monitor>> {
        Ok(Vec::new())
    }

    fn theme(&self) -> Result<Theme> {
        Ok(Theme::Light)
    }

    #[cfg(all(
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ),
        feature = "gtk"
    ))]
    fn gtk_window(&self) -> Result<gtk::ApplicationWindow> {
        unimplemented!()
    }

    #[cfg(all(
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ),
        feature = "gtk"
    ))]
    fn default_vbox(&self) -> Result<gtk::Box> {
        unimplemented!()
    }

    #[cfg(target_os = "android")]
    fn activity_name(&self) -> Result<String> {
        unimplemented!()
    }

    #[cfg(target_os = "ios")]
    fn scene_identifier(&self) -> Result<String> {
        unimplemented!()
    }

    fn window_handle(
        &self,
    ) -> std::result::Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError>
    {
        #[cfg(target_os = "linux")]
        return unsafe {
            Ok(raw_window_handle::WindowHandle::borrow_raw(
                raw_window_handle::RawWindowHandle::Xlib(raw_window_handle::XlibWindowHandle::new(
                    0,
                )),
            ))
        };
        #[cfg(target_os = "macos")]
        return unsafe {
            Ok(raw_window_handle::WindowHandle::borrow_raw(
                raw_window_handle::RawWindowHandle::AppKit(
                    raw_window_handle::AppKitWindowHandle::new(std::ptr::NonNull::from(&()).cast()),
                ),
            ))
        };
        #[cfg(windows)]
        return unsafe {
            Ok(raw_window_handle::WindowHandle::borrow_raw(
                raw_window_handle::RawWindowHandle::Win32(
                    raw_window_handle::Win32WindowHandle::new(std::num::NonZeroIsize::MIN),
                ),
            ))
        };
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        unimplemented!();
    }

    fn center(&self) -> Result<()> {
        Ok(())
    }

    fn request_user_attention(&self, request_type: Option<UserAttentionType>) -> Result<()> {
        Ok(())
    }

    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &mut self,
        pending: PendingWindow<T, Self::Runtime>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self::Runtime>> {
        self.context.create_window(pending)
    }

    fn create_webview(
        &mut self,
        pending: PendingWebview<T, Self::Runtime>,
    ) -> Result<DetachedWebview<T, Self::Runtime>> {
        self.context.create_webview(self.id, pending)
    }

    fn set_resizable(&self, resizable: bool) -> Result<()> {
        Ok(())
    }

    fn set_maximizable(&self, maximizable: bool) -> Result<()> {
        Ok(())
    }

    fn set_minimizable(&self, minimizable: bool) -> Result<()> {
        Ok(())
    }

    fn set_closable(&self, closable: bool) -> Result<()> {
        Ok(())
    }

    fn set_title<S: Into<String>>(&self, title: S) -> Result<()> {
        Ok(())
    }

    fn maximize(&self) -> Result<()> {
        Ok(())
    }

    fn unmaximize(&self) -> Result<()> {
        Ok(())
    }

    fn minimize(&self) -> Result<()> {
        Ok(())
    }

    fn unminimize(&self) -> Result<()> {
        Ok(())
    }

    fn show(&self) -> Result<()> {
        self.visible.store(true, Ordering::Relaxed);
        // Wake the loop: a hidden webview's pending paint set no deadline.
        self.context
            .run_tx
            .send(Message::Task(Box::new(|| {})))
            .map_err(|_| Error::FailedToSendMessage)
    }

    fn hide(&self) -> Result<()> {
        self.visible.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn close(&self) -> Result<()> {
        self.context.send_message(Message::CloseWindow(self.id))?;
        Ok(())
    }

    fn destroy(&self) -> Result<()> {
        self.context.send_message(Message::DestroyWindow(self.id))?;
        Ok(())
    }

    fn set_decorations(&self, decorations: bool) -> Result<()> {
        Ok(())
    }

    fn set_shadow(&self, shadow: bool) -> Result<()> {
        Ok(())
    }

    fn set_always_on_bottom(&self, always_on_bottom: bool) -> Result<()> {
        Ok(())
    }

    fn set_always_on_top(&self, always_on_top: bool) -> Result<()> {
        Ok(())
    }

    fn set_visible_on_all_workspaces(&self, visible_on_all_workspaces: bool) -> Result<()> {
        Ok(())
    }

    fn set_content_protected(&self, protected: bool) -> Result<()> {
        Ok(())
    }

    fn set_size(&self, size: Size) -> Result<()> {
        Ok(())
    }

    fn set_min_size(&self, size: Option<Size>) -> Result<()> {
        Ok(())
    }

    fn set_max_size(&self, size: Option<Size>) -> Result<()> {
        Ok(())
    }

    fn set_position(&self, position: Position) -> Result<()> {
        Ok(())
    }

    fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn set_simple_fullscreen(&self, enable: bool) -> Result<()> {
        Ok(())
    }

    fn set_focus(&self) -> Result<()> {
        Ok(())
    }

    fn set_focusable(&self, focusable: bool) -> Result<()> {
        Ok(())
    }

    fn set_icon(&self, icon: Icon<'_>) -> Result<()> {
        Ok(())
    }

    fn set_skip_taskbar(&self, skip: bool) -> Result<()> {
        Ok(())
    }

    fn set_cursor_grab(&self, grab: bool) -> Result<()> {
        Ok(())
    }

    fn set_cursor_visible(&self, visible: bool) -> Result<()> {
        Ok(())
    }

    fn set_cursor_icon(&self, icon: CursorIcon) -> Result<()> {
        Ok(())
    }

    fn set_cursor_position<Pos: Into<Position>>(&self, position: Pos) -> Result<()> {
        Ok(())
    }

    fn set_ignore_cursor_events(&self, ignore: bool) -> Result<()> {
        Ok(())
    }

    fn start_dragging(&self) -> Result<()> {
        Ok(())
    }

    fn start_resize_dragging(&self, direction: tauri_runtime::ResizeDirection) -> Result<()> {
        Ok(())
    }

    fn set_progress_bar(&self, progress_state: ProgressBarState) -> Result<()> {
        Ok(())
    }

    fn set_badge_count(&self, count: Option<i64>, desktop_filename: Option<String>) -> Result<()> {
        Ok(())
    }

    fn set_badge_label(&self, label: Option<String>) -> Result<()> {
        Ok(())
    }

    fn set_overlay_icon(&self, icon: Option<Icon<'_>>) -> Result<()> {
        Ok(())
    }

    fn set_title_bar_style(&self, style: tauri_utils::TitleBarStyle) -> Result<()> {
        Ok(())
    }

    fn set_traffic_light_position(&self, position: Position) -> Result<()> {
        Ok(())
    }

    fn set_size_constraints(
        &self,
        constraints: tauri_runtime::window::WindowSizeConstraints,
    ) -> Result<()> {
        Ok(())
    }

    fn set_theme(&self, theme: Option<Theme>) -> Result<()> {
        Ok(())
    }

    fn set_enabled(&self, enabled: bool) -> Result<()> {
        Ok(())
    }

    fn is_enabled(&self) -> Result<bool> {
        Ok(true)
    }

    fn is_always_on_top(&self) -> Result<bool> {
        Ok(false)
    }

    fn set_background_color(&self, color: Option<tauri_utils::config::Color>) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct EventProxy {
    tx: Sender<Message>,
}

impl<T: UserEvent> EventLoopProxy<T> for EventProxy {
    fn send_event(&self, event: T) -> Result<()> {
        self.tx
            .send(Message::UserEvent(Box::new(event)))
            .map_err(|_| Error::FailedToSendMessage)
    }
}

#[derive(Debug)]
pub struct BlitzRuntime {
    is_running: Arc<AtomicBool>,
    pub context: RuntimeContext,
    run_rx: Receiver<Message>,
}

impl BlitzRuntime {
    fn init() -> Self {
        webview::START.get_or_init(Instant::now);
        let is_running = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel();
        let context = RuntimeContext {
            is_running: is_running.clone(),
            windows: Default::default(),
            shortcuts: Default::default(),
            run_tx: tx,
            main_thread_id: std::thread::current().id(),
            next_window_id: Default::default(),
            next_webview_id: Default::default(),
            next_window_event_id: Default::default(),
            next_webview_event_id: Default::default(),
        };
        Self {
            is_running,
            context,
            run_rx: rx,
        }
    }
}

/// Selects the [`BlitzRuntime`], e.g. `tauri::Builder::default().runtime(BlitzRuntimeInitAttrs::default())`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlitzRuntimeInitAttrs {}

impl<T: UserEvent> RuntimeInitAttrs<T> for BlitzRuntimeInitAttrs {
    type Runtime = BlitzRuntime;
}

impl<T: UserEvent> From<BlitzRuntimeInitAttrs> for tauri_runtime::dynamic::DynRuntimeInitAttrs<T> {
    fn from(attrs: BlitzRuntimeInitAttrs) -> Self {
        Self::new(attrs)
    }
}

impl<T: UserEvent> Runtime<T> for BlitzRuntime {
    type WindowDispatcher = BlitzWindowDispatcher;
    type WebviewDispatcher = BlitzWebviewDispatcher;
    type Handle = BlitzRuntimeHandle;
    type EventLoopProxy = EventProxy;
    type RuntimeWebviewAttributes = ();
    type RuntimeInitAttrs = BlitzRuntimeInitAttrs;
    type WindowOpener = ();
    type Webview = ();

    fn new(_args: RuntimeInitArgs<BlitzRuntimeInitAttrs>) -> Result<Self> {
        Ok(Self::init())
    }

    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    fn new_any_thread(_args: RuntimeInitArgs<BlitzRuntimeInitAttrs>) -> Result<Self> {
        Ok(Self::init())
    }

    fn create_proxy(&self) -> EventProxy {
        EventProxy {
            tx: self.context.run_tx.clone(),
        }
    }

    fn handle(&self) -> Self::Handle {
        BlitzRuntimeHandle {
            context: self.context.clone(),
        }
    }

    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &self,
        pending: PendingWindow<T, Self>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self>> {
        self.context.create_window(pending)
    }

    fn create_webview(
        &self,
        window_id: WindowId,
        pending: PendingWebview<T, Self>,
    ) -> Result<DetachedWebview<T, Self>> {
        self.context.create_webview(window_id, pending)
    }

    fn primary_monitor(&self) -> Option<Monitor> {
        None
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Option<Monitor> {
        None
    }

    fn available_monitors(&self) -> Vec<Monitor> {
        Vec::new()
    }

    fn set_theme(&self, theme: Option<Theme>) {
        // no-op
    }

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn set_activation_policy(&mut self, activation_policy: tauri_runtime::ActivationPolicy) {}

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn set_dock_visibility(&mut self, visible: bool) {}

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn show(&self) {}

    #[cfg(target_os = "macos")]
    #[cfg_attr(docsrs, doc(cfg(target_os = "macos")))]
    fn hide(&self) {}

    fn set_device_event_filter(&mut self, filter: DeviceEventFilter) {}

    #[cfg(any(
        target_os = "macos",
        windows,
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    fn run_iteration<F: FnMut(RunEvent<T>)>(&mut self, callback: F) {}

    fn run_return<F: FnMut(RunEvent<T>) + 'static>(self, callback: F) -> i32 {
        self.run(callback);

        0
    }

    fn run<F: FnMut(RunEvent<T>) + 'static>(self, mut callback: F) {
        self.is_running.store(true, Ordering::Relaxed);
        callback(RunEvent::Ready);
        let windows = self.context.windows.clone();
        let with_webview = |id: u32, f: &mut dyn FnMut(&mut webview::BlitzWebview)| {
            for w in windows.borrow_mut().values_mut() {
                if let Some(wv) = w.webviews.iter_mut().find(|wv| wv.id == id) {
                    f(wv);
                }
            }
        };
        // Exit once a close/destroy left no windows, or on `request_exit`, unless the app prevents it.
        let exit_check = |callback: &mut F, code: Option<i32>| -> bool {
            let (tx, rx) = channel();
            callback(RunEvent::ExitRequested { code, tx });
            !matches!(rx.try_recv(), Ok(ExitRequestedEventAction::Prevent))
        };
        'outer: loop {
            let deadline = windows
                .borrow()
                .values()
                .flat_map(|w| w.webviews.iter())
                .filter_map(webview::BlitzWebview::deadline)
                .min();
            let timeout = deadline.map_or(Duration::from_secs(1), |d| {
                d.saturating_duration_since(Instant::now())
            });
            let mut messages = Vec::new();
            let t_wait = Instant::now();
            match self.run_rx.recv_timeout(timeout) {
                Ok(m) => messages.push(m),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            while let Ok(m) = self.run_rx.try_recv() {
                messages.push(m);
            }
            let (wait_ms, n_msgs, t_msgs) = (
                t_wait.elapsed().as_secs_f64() * 1000.0,
                messages.len(),
                Instant::now(),
            );
            for m in messages {
                match m {
                    Message::Task(task) => task(),
                    Message::Eval { webview, script } => {
                        with_webview(webview, &mut |wv| wv.eval(&script))
                    }
                    Message::FetchDone {
                        webview,
                        id,
                        response,
                    } => {
                        let mut response = Some(response);
                        with_webview(webview, &mut |wv| {
                            wv.fetch_done(id, response.take().unwrap())
                        });
                    }
                    Message::Navigate { webview, url } => {
                        with_webview(webview, &mut |wv| wv.navigate(&url))
                    }
                    Message::Pointer {
                        webview,
                        x,
                        y,
                        down,
                    } => with_webview(webview, &mut |wv| wv.pointer(x, y, down)),
                    Message::UserEvent(event) => {
                        if let Ok(event) = event.downcast::<T>() {
                            callback(RunEvent::UserEvent(*event));
                        }
                    }
                    Message::Exit(code) => {
                        if exit_check(&mut callback, Some(code)) {
                            break 'outer;
                        }
                    }
                    Message::CloseWindow(id) => {
                        let label = windows.borrow().get(&id).map(|w| w.label.clone());
                        if let Some(label) = label {
                            let (tx, rx) = channel();
                            callback(RunEvent::WindowEvent {
                                label,
                                event: WindowEvent::CloseRequested { signal_tx: tx },
                            });
                            if !matches!(rx.try_recv(), Ok(true)) {
                                windows.borrow_mut().remove(&id);
                                if windows.borrow().is_empty() && exit_check(&mut callback, None) {
                                    break 'outer;
                                }
                            }
                        }
                    }
                    Message::DestroyWindow(id) => {
                        let removed = windows.borrow_mut().remove(&id).is_some();
                        if removed && windows.borrow().is_empty() && exit_check(&mut callback, None)
                        {
                            break 'outer;
                        }
                    }
                }
            }
            let (msgs_ms, t_tick) = (t_msgs.elapsed().as_secs_f64() * 1000.0, Instant::now());
            for w in windows.borrow_mut().values_mut() {
                for wv in &mut w.webviews {
                    wv.tick();
                }
            }
            // BLITZ_TAURI_TRACE_LOOP=1: loop turns over 30 ms (wait, messages, tick).
            let tick_ms = t_tick.elapsed().as_secs_f64() * 1000.0;
            if std::env::var_os("BLITZ_TAURI_TRACE_LOOP").is_some()
                && wait_ms + msgs_ms + tick_ms > 30.0
            {
                eprintln!(
                    "loop: timeout {:.1} wait {wait_ms:.1} msgs {n_msgs} {msgs_ms:.1} tick {tick_ms:.1}",
                    timeout.as_secs_f64() * 1000.0
                );
            }
            callback(RunEvent::MainEventsCleared);
        }
        callback(RunEvent::Exit);
    }

    fn cursor_position(&self) -> Result<PhysicalPosition<f64>> {
        Ok(PhysicalPosition::new(0.0, 0.0))
    }
}
