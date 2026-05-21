use objc::{msg_send, sel, sel_impl};
use rand::{distributions::Alphanumeric, Rng};
use tauri::{
    command,
    plugin::{Builder, TauriPlugin},
    Emitter, Runtime, Window,
};

// Tracks visibility + last-known header height for this app so resize /
// fullscreen-exit callbacks can re-apply the same layout without an
// extra IPC round-trip from the frontend.
static mut TRAFFIC_LIGHTS_VISIBLE: bool = true;
static mut TRAFFIC_LIGHT_HEADER_HEIGHT: f64 = DEFAULT_HEADER_HEIGHT;

/// AppKit's natural rest position for `NSWindowButton.origin.y` inside
/// the title-bar container. This is the per-OS offset Apple shifted in
/// Tahoe (~5pt on macOS 15, ~7pt on macOS 26). Captured on the first
/// read so subsequent reads — which may pick up a post-resize
/// autoresized value rather than the natural one — don't feed back
/// into the centering formula and cause it to drift.
static NATURAL_BUTTON_ORIGIN_Y: std::sync::OnceLock<f64> = std::sync::OnceLock::new();

/// Fallback header height (logical px) when the frontend has not yet
/// reported one. Matches readest's standard `h-11` header so the
/// initial paint before React mounts is close to correct.
const DEFAULT_HEADER_HEIGHT: f64 = 44.0;

/// Horizontal inset for the leftmost close button.
const TRAFFIC_LIGHT_X_INSET: f64 = 10.0;

struct UnsafeWindowHandle(*mut std::ffi::c_void);
unsafe impl Send for UnsafeWindowHandle {}
unsafe impl Sync for UnsafeWindowHandle {}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("traffic_light")
        .on_window_ready(|window| {
            #[cfg(target_os = "macos")]
            setup_traffic_light_positioner(window.clone());
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                let window = window_clone.clone();
                if let tauri::WindowEvent::ThemeChanged(_theme) = event {
                    setup_traffic_light_positioner(window);
                }
            });
        })
        .build()
}

#[command]
pub fn set_traffic_lights(window: Window, visible: bool, header_height: f64) {
    unsafe {
        TRAFFIC_LIGHTS_VISIBLE = visible;
        if header_height > 0.0 {
            TRAFFIC_LIGHT_HEADER_HEIGHT = header_height;
        }

        let ns_window = match window.ns_window() {
            Ok(handle) => handle,
            Err(_) => return,
        };
        position_traffic_lights(UnsafeWindowHandle(ns_window), visible);
    }
}

/// Centers the close button vertically inside `header_height`.
///
/// `y` (the value tao forwards to `[NSWindowButton setFrameOrigin:]`)
/// is the distance from the title-bar container's top to the button's
/// top. After tao applies it, the button's final position in window-
/// top coords is `y - button_origin_y_in_container`, because tao does
/// not touch `origin.y` — it preserves AppKit's natural rest position.
///
/// Apple shifted that rest position on macOS 26 (Tahoe): the close
/// button sits ~2pt higher in the container than it did on macOS 15
/// (`button.origin.y` reads ~7 on Tahoe vs ~5 on Sonoma/Sequoia). By
/// reading `button.origin.y` live and adding it to the centering math,
/// the formula self-corrects without an `NSProcessInfo` lookup.
fn compute_traffic_light_y(header_height: f64, button_height: f64, button_origin_y: f64) -> f64 {
    ((header_height - button_height) / 2.0 + button_origin_y).max(0.0)
}

/// Reads the close button's current frame.height and (on the first
/// call only) caches its origin.y as the natural AppKit rest position.
/// Returns `(14, 5)` if the window has no standard buttons (e.g.
/// decorationless utility webviews never call this in practice).
///
/// We **must not** re-read origin.y on every invocation. Some macOS
/// versions appear to autoresize the button's frame inside the
/// title-bar container when the container is resized — feeding that
/// value back into the centering formula produces a runaway where
/// each push grows y, the container grows, AppKit re-pins the button,
/// and the next push grows y again. Caching on first read makes the
/// formula a fixed-point in the natural offset, which is what we want.
unsafe fn measure_close_button(ns_window: *mut std::ffi::c_void) -> (f64, f64) {
    use cocoa::appkit::{NSWindow, NSWindowButton};
    use cocoa::foundation::NSRect;
    let ns_window = ns_window as cocoa::base::id;
    let close = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
    if close.is_null() {
        return (14.0, *NATURAL_BUTTON_ORIGIN_Y.get().unwrap_or(&5.0));
    }
    let frame: NSRect = msg_send![close, frame];
    let cached_origin_y = *NATURAL_BUTTON_ORIGIN_Y.get_or_init(|| frame.origin.y);
    (frame.size.height, cached_origin_y)
}

/// Owns both the title-bar container size and the standard window
/// buttons' frame origins. We don't call Tauri's
/// `set_traffic_light_position` (which would have routed through tao's
/// `inset_traffic_lights` and ping-ponged with this code on every
/// drawRect), so this is the sole authority for traffic-light layout.
/// The plugin's resize / theme-change / full-screen-exit callbacks
/// re-invoke this so AppKit can't leave the buttons stale.
fn position_traffic_lights(ns_window_handle: UnsafeWindowHandle, visible: bool) {
    use cocoa::appkit::{NSView, NSWindow, NSWindowButton};
    use cocoa::foundation::NSRect;
    let ns_window = ns_window_handle.0 as cocoa::base::id;
    unsafe {
        let close = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
        if close.is_null() {
            return;
        }
        let miniaturize =
            ns_window.standardWindowButton_(NSWindowButton::NSWindowMiniaturizeButton);
        let zoom = ns_window.standardWindowButton_(NSWindowButton::NSWindowZoomButton);
        let title_bar_container_view = close.superview().superview();

        let title_bar_frame_height = if visible {
            let (button_height, button_origin_y) = measure_close_button(ns_window_handle.0);
            let y = compute_traffic_light_y(
                TRAFFIC_LIGHT_HEADER_HEIGHT,
                button_height,
                button_origin_y,
            );
            button_height + y
        } else {
            0.0
        };
        let mut title_bar_rect = NSView::frame(title_bar_container_view);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = NSView::frame(ns_window).size.height - title_bar_frame_height;
        let _: () = msg_send![title_bar_container_view, setFrame: title_bar_rect];

        if !visible || miniaturize.is_null() || zoom.is_null() {
            return;
        }

        // Restore each button's frame.origin: x from the configured
        // inset, y from the cached natural offset captured by
        // measure_close_button so AppKit's autoresize on a container
        // change can't drift us. Keeping origin.y stable means the
        // centering formula stays a fixed point across resize / theme /
        // full-screen events without per-OS tuning.
        let cached_origin_y = *NATURAL_BUTTON_ORIGIN_Y.get().unwrap_or(&5.0);
        let close_rect: NSRect = msg_send![close, frame];
        let miniaturize_rect: NSRect = msg_send![miniaturize, frame];
        let space_between = miniaturize_rect.origin.x - close_rect.origin.x;
        for (i, button) in [close, miniaturize, zoom].iter().enumerate() {
            let origin = cocoa::foundation::NSPoint::new(
                TRAFFIC_LIGHT_X_INSET + (i as f64 * space_between),
                cached_origin_y,
            );
            let _: () = msg_send![*button, setFrameOrigin: origin];
        }
    }
}

#[derive(Debug)]
struct WindowState<R: Runtime> {
    window: Window<R>,
}

pub fn setup_traffic_light_positioner<R: Runtime>(window: Window<R>) {
    use cocoa::appkit::NSWindow;
    use cocoa::base::{id, BOOL};
    use cocoa::foundation::NSUInteger;
    use objc::runtime::{Object, Sel};
    use std::ffi::c_void;

    // The on_window_did_resize handler below already gates positioning to
    // the main/reader windows by label — extending the same gate to the
    // initial positioning. Other windows (the clip-* webview, future
    // decorationless utility windows) have no standard NSWindow buttons,
    // and `close.superview().superview()` in position_traffic_lights
    // would null-deref on them.
    let label = window.label().to_string();
    if label != "main" && !label.starts_with("reader") {
        return;
    }

    // Initial positioning. `position_traffic_lights` owns both the
    // container size and the per-button frame origins, so the moment
    // `on_window_ready` fires the buttons are centered against the
    // current `TRAFFIC_LIGHT_HEADER_HEIGHT` — which defaults to the
    // app's standard h-11 (44px) until React reports the active
    // page's real height through the `set_traffic_lights` IPC.
    unsafe {
        position_traffic_lights(
            UnsafeWindowHandle(window.ns_window().expect("Failed to create window handle")),
            TRAFFIC_LIGHTS_VISIBLE,
        );
    }

    // Ensure they stay in place while resizing the window.
    fn with_window_state<R: Runtime, F: FnOnce(&mut WindowState<R>) -> T, T>(
        this: &Object,
        func: F,
    ) {
        let ptr = unsafe {
            let x: *mut c_void = *this.get_ivar("app_box");
            &mut *(x as *mut WindowState<R>)
        };
        func(ptr);
    }

    unsafe {
        let ns_win = window
            .ns_window()
            .expect("NS Window should exist to mount traffic light delegate.")
            as id;

        let current_delegate: id = ns_win.delegate();

        extern "C" fn on_window_should_close(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, windowShouldClose: sender]
            }
        }
        extern "C" fn on_window_will_close(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillClose: notification];
            }
        }
        extern "C" fn on_window_did_resize<R: Runtime>(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    let id = state
                        .window
                        .ns_window()
                        .expect("NS window should exist on state to handle resize")
                        as id;

                    if state.window.label() == "main" || state.window.label().starts_with("reader")
                    {
                        position_traffic_lights(
                            UnsafeWindowHandle(id as *mut std::ffi::c_void),
                            TRAFFIC_LIGHTS_VISIBLE,
                        );
                    }
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResize: notification];
            }
        }
        extern "C" fn on_window_did_move(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidMove: notification];
            }
        }
        extern "C" fn on_window_did_change_backing_properties(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidChangeBackingProperties: notification];
            }
        }
        extern "C" fn on_window_did_become_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidBecomeKey: notification];
            }
        }
        extern "C" fn on_window_did_resign_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResignKey: notification];
            }
        }
        extern "C" fn on_dragging_entered(this: &Object, _cmd: Sel, notification: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, draggingEntered: notification]
            }
        }
        extern "C" fn on_prepare_for_drag_operation(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, prepareForDragOperation: notification]
            }
        }
        extern "C" fn on_perform_drag_operation(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, performDragOperation: sender]
            }
        }
        extern "C" fn on_conclude_drag_operation(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, concludeDragOperation: notification];
            }
        }
        extern "C" fn on_dragging_exited(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, draggingExited: notification];
            }
        }
        extern "C" fn on_window_will_use_full_screen_presentation_options(
            this: &Object,
            _cmd: Sel,
            window: id,
            proposed_options: NSUInteger,
        ) -> NSUInteger {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, window: window willUseFullScreenPresentationOptions: proposed_options]
            }
        }
        extern "C" fn on_window_did_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("did-enter-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("will-enter-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("did-exit-fullscreen", ())
                        .expect("Failed to emit event");

                    let id = state.window.ns_window().expect("Failed to emit event") as id;
                    if state.window.label() == "main" || state.window.label().starts_with("reader")
                    {
                        position_traffic_lights(
                            UnsafeWindowHandle(id as *mut std::ffi::c_void),
                            TRAFFIC_LIGHTS_VISIBLE,
                        );
                    }
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(this, |state: &mut WindowState<R>| {
                    state
                        .window
                        .emit("will-exit-fullscreen", ())
                        .expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_fail_to_enter_full_screen(
            this: &Object,
            _cmd: Sel,
            window: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidFailToEnterFullScreen: window];
            }
        }
        extern "C" fn on_effective_appearance_did_change(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, effectiveAppearanceDidChange: notification];
            }
        }
        extern "C" fn on_effective_appearance_did_changed_on_main_thread(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![
                    super_del,
                    effectiveAppearanceDidChangedOnMainThread: notification
                ];
            }
        }

        // Are we deallocing this properly ? (I miss safe Rust :(  )
        let window_label = window.label().to_string();

        let app_state = WindowState { window };
        let app_box = Box::into_raw(Box::new(app_state)) as *mut c_void;
        let random_str: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(20)
            .map(char::from)
            .collect();

        // We need to ensure we have a unique delegate name, otherwise we will panic while trying to create a duplicate
        // delegate with the same name.
        let delegate_name = format!("windowDelegate_{}_{}", window_label, random_str);

        ns_win.setDelegate_(delegate!(&delegate_name, {
            window: id = ns_win,
            app_box: *mut c_void = app_box,
            toolbar: id = cocoa::base::nil,
            super_delegate: id = current_delegate,
            (windowShouldClose:) => on_window_should_close as extern "C" fn(&Object, Sel, id) -> BOOL,
            (windowWillClose:) => on_window_will_close as extern "C" fn(&Object, Sel, id),
            (windowDidResize:) => on_window_did_resize::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidMove:) => on_window_did_move as extern "C" fn(&Object, Sel, id),
            (windowDidChangeBackingProperties:) => on_window_did_change_backing_properties as extern "C" fn(&Object, Sel, id),
            (windowDidBecomeKey:) => on_window_did_become_key as extern "C" fn(&Object, Sel, id),
            (windowDidResignKey:) => on_window_did_resign_key as extern "C" fn(&Object, Sel, id),
            (draggingEntered:) => on_dragging_entered as extern "C" fn(&Object, Sel, id) -> BOOL,
            (prepareForDragOperation:) => on_prepare_for_drag_operation as extern "C" fn(&Object, Sel, id) -> BOOL,
            (performDragOperation:) => on_perform_drag_operation as extern "C" fn(&Object, Sel, id) -> BOOL,
            (concludeDragOperation:) => on_conclude_drag_operation as extern "C" fn(&Object, Sel, id),
            (draggingExited:) => on_dragging_exited as extern "C" fn(&Object, Sel, id),
            (window:willUseFullScreenPresentationOptions:) => on_window_will_use_full_screen_presentation_options as extern "C" fn(&Object, Sel, id, NSUInteger) -> NSUInteger,
            (windowDidEnterFullScreen:) => on_window_did_enter_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowWillEnterFullScreen:) => on_window_will_enter_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidExitFullScreen:) => on_window_did_exit_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowWillExitFullScreen:) => on_window_will_exit_full_screen::<R> as extern "C" fn(&Object, Sel, id),
            (windowDidFailToEnterFullScreen:) => on_window_did_fail_to_enter_full_screen as extern "C" fn(&Object, Sel, id),
            (effectiveAppearanceDidChange:) => on_effective_appearance_did_change as extern "C" fn(&Object, Sel, id),
            (effectiveAppearanceDidChangedOnMainThread:) => on_effective_appearance_did_changed_on_main_thread as extern "C" fn(&Object, Sel, id)
        }))
    }
}
