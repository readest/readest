//! Close-to-hide for the macOS main window.
//!
//! Closing the main window (red traffic light or Cmd+W) hides it: the
//! window vanishes, the app stays in the Dock and the open book stays
//! loaded. On every successful AppKit path it must hide rather than
//! minimize — mapping close to minimize on Tahoe (PR #4890) made the red
//! button behave like the yellow one (#5240) — and it must never quit.
//!
//! On macOS 26 (Tahoe) a plain `hide()` is not enough: the OS can leave
//! a focused black phantom window on screen (#4875). The defensive path
//! adapts kitty's zero-frame workaround to Readest's reusable main
//! window, restoring its frame before the next show.
//!
//! If AppKit itself refuses to leave fullscreen, neither the zero-frame
//! workaround nor a plain `hide()` is safe. That exceptional path alone
//! minimizes as a conservative fallback and is undone by the existing
//! dock-reopen handler.
//!
//! Thread-safety: everything here runs on the AppKit main thread —
//! `on_window_event` closures and the `RunEvent` run-loop closure are
//! both dispatched from the main event loop — so the raw `msg_send!`
//! calls are sound. The `Mutex` around the saved frame exists only to
//! make the `static` safe, mirroring the statics in `traffic_light.rs`.

use cocoa::appkit::{NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};
use cocoa::base::{id, nil, NO, YES};
use cocoa::foundation::NSUInteger;
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{msg_send, sel, sel_impl};
use std::sync::Mutex;
use tauri::plugin::{Builder, TauriPlugin};

/// The main window's real frame, captured immediately before the Tahoe
/// defensive hide zeroes it. `None` while no defensive hide is pending.
static SAVED_MAIN_FRAME: Mutex<Option<NSRect>> = Mutex::new(None);

/// Fullscreen transitions are asynchronous. Keep the close request pending
/// until the AppKit delegate reports success or failure.
static FULLSCREEN_HIDE_STATE: Mutex<FullscreenHideState> =
    Mutex::new(FullscreenHideState { pending: false });

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainWindowCloseAction {
    Hide,
    DefensiveHide,
    ExitFullscreenThenDefensiveHide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FullscreenHideCompletion {
    DefensiveHide,
    /// Last-resort fallback when AppKit refuses to leave fullscreen. A plain
    /// hide would re-enter Tahoe's phantom-window path (#4875).
    Minimize,
}

#[derive(Debug, Default)]
struct FullscreenHideState {
    pending: bool,
}

impl FullscreenHideState {
    fn begin(&mut self) {
        self.pending = true;
    }

    fn cancel(&mut self) {
        self.pending = false;
    }

    fn finish(&mut self, exit_succeeded: bool) -> Option<FullscreenHideCompletion> {
        if !std::mem::take(&mut self.pending) {
            return None;
        }
        Some(if exit_succeeded {
            FullscreenHideCompletion::DefensiveHide
        } else {
            FullscreenHideCompletion::Minimize
        })
    }
}

fn main_window_close_action(
    tahoe_workaround_required: bool,
    fullscreen: bool,
) -> MainWindowCloseAction {
    if tahoe_workaround_required && fullscreen {
        MainWindowCloseAction::ExitFullscreenThenDefensiveHide
    } else if tahoe_workaround_required {
        MainWindowCloseAction::DefensiveHide
    } else {
        MainWindowCloseAction::Hide
    }
}

/// Hides the main window on close. Called from the `CloseRequested`
/// handler in `lib.rs` (main thread).
pub fn hide_main_window(window: &tauri::WebviewWindow) {
    let fullscreen = is_fullscreen_or_transitioning(window);
    match main_window_close_action(super::os_version::is_macos_tahoe(), fullscreen) {
        MainWindowCloseAction::Hide => {
            let _ = window.hide();
        }
        MainWindowCloseAction::DefensiveHide => {
            FULLSCREEN_HIDE_STATE.lock().unwrap().cancel();
            defensive_hide(&window.as_ref().window());
        }
        MainWindowCloseAction::ExitFullscreenThenDefensiveHide => {
            FULLSCREEN_HIDE_STATE.lock().unwrap().begin();
            if let Err(error) = window.set_fullscreen(false) {
                log::error!("Failed to leave fullscreen before hiding main window: {error}");
                FULLSCREEN_HIDE_STATE.lock().unwrap().cancel();
                // A plain hide can produce Tahoe's phantom window while AppKit
                // still owns the fullscreen frame. This is intentionally the
                // only path where close degrades to minimize.
                let _ = window.minimize();
            }
        }
    }
}

/// Completes a close requested while fullscreen after AppKit has returned the
/// window to its normal Space. Called directly from the traffic-light
/// delegate's `windowDidExitFullScreen:` callback.
pub fn finish_pending_fullscreen_hide<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if FULLSCREEN_HIDE_STATE.lock().unwrap().finish(true)
        == Some(FullscreenHideCompletion::DefensiveHide)
    {
        defensive_hide(window);
    }
}

/// Guarantees that a failed fullscreen transition cannot leave a close request
/// pending forever. AppKit still owns the fullscreen frame, so changing it to
/// 0x0 is unsafe here, while a plain hide can reproduce Tahoe's phantom
/// window. Minimize is therefore the safest last-resort fallback.
pub fn finish_failed_fullscreen_hide<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if FULLSCREEN_HIDE_STATE.lock().unwrap().finish(false)
        == Some(FullscreenHideCompletion::Minimize)
    {
        log::warn!("Fullscreen exit failed; minimizing the main window as a safe fallback");
        let _ = window.minimize();
    }
}

fn is_fullscreen_or_transitioning(window: &tauri::WebviewWindow) -> bool {
    // tao updates its fullscreen state at the start of a transition. The
    // native style bit covers the opposite half of an exit transition, while
    // tao's state covers the start of an enter transition.
    if window.is_fullscreen().unwrap_or(false) {
        return true;
    }
    let Ok(ns_window) = window.ns_window() else {
        return false;
    };
    unsafe {
        let style_mask: NSUInteger = msg_send![ns_window as id, styleMask];
        style_mask & NSWindowStyleMask::NSFullScreenWindowMask.bits() != 0
    }
}

/// Tahoe defensive hide: zero the frame, then order out, both in the
/// same runloop turn.
///
/// The zero rect keeps the old frame's *top-left* corner: AppKit frames
/// are bottom-left anchored, so the top edge is `origin.y + height`.
/// That keeps tao's `outer_position()` (top-left based) unchanged while
/// hidden. The tao delegate is suspended only for the frame mutation so
/// its resize/move listeners (including `tauri-plugin-window-state`) never
/// observe the temporary 0x0 geometry. It is restored before `orderOut:`
/// so focus-loss events still flow normally.
fn defensive_hide<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let Ok(ns_window) = window.ns_window() else {
        let _ = window.hide();
        return;
    };
    let ns_window = ns_window as id;
    unsafe {
        let frame: NSRect = msg_send![ns_window, frame];
        let mut saved_frame = SAVED_MAIN_FRAME.lock().unwrap();
        if saved_frame.is_some() {
            let _: () = msg_send![ns_window, orderOut: nil];
            return;
        }
        *saved_frame = Some(frame);
        drop(saved_frame);

        let zero = NSRect::new(
            NSPoint::new(frame.origin.x, frame.origin.y + frame.size.height),
            NSSize::new(0.0, 0.0),
        );

        // A 0x0 resize event would overwrite the window-state plugin's cache.
        // Suppress only this temporary geometry notification; restoring the
        // delegate before orderOut keeps normal focus and visibility events.
        let delegate: id = msg_send![ns_window, delegate];
        let _: () = msg_send![ns_window, setDelegate: nil];
        let _: () = msg_send![ns_window, setFrame: zero display: NO];
        let _: () = msg_send![ns_window, setDelegate: delegate];
        let _: () = msg_send![ns_window, orderOut: nil];
    }
}

/// Restores the frame saved by the defensive hide; no-op when none is
/// pending. Called from the dock `Reopen` handler before `show()`, and
/// from `Focused(true)` as a safety net for JS-side `show()` callers
/// (e.g. `ensureMainLibraryWindow` in `src/utils/nav.ts`).
pub fn restore_main_window_frame(window: &tauri::WebviewWindow) {
    FULLSCREEN_HIDE_STATE.lock().unwrap().cancel();
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let mut saved_frame = SAVED_MAIN_FRAME.lock().unwrap();
    let Some(frame) = saved_frame.as_ref().copied() else {
        return;
    };
    unsafe {
        let _: () = msg_send![ns_window as id, setFrame: frame display: YES];
    }
    saved_frame.take();
}

/// Hides the title text of every window so each one can carry a real title.
///
/// `TitleBarStyle::Overlay` only makes the title bar transparent and extends
/// the content view underneath it — AppKit still draws the title string
/// centered on top of Readest's own header. The windows therefore shipped with
/// an empty title, which left window switchers, the Window menu and VoiceOver
/// with nothing to announce. Hiding the text instead lets the frontend put the
/// open book's name in the title (see `tauriSetWindowTitle`) without any of it
/// being painted over the header.
///
/// Runs on window ready so it also covers the reader windows the frontend
/// creates at runtime (`src/utils/nav.ts`).
pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::new("window_title")
        .on_window_ready(|window| {
            let Ok(ns_window) = window.ns_window() else {
                return;
            };
            unsafe {
                (ns_window as id).setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::{
        main_window_close_action, FullscreenHideCompletion, FullscreenHideState,
        MainWindowCloseAction,
    };

    #[test]
    fn hides_plainly_without_the_tahoe_workaround() {
        assert_eq!(
            main_window_close_action(false, false),
            MainWindowCloseAction::Hide
        );
    }

    #[test]
    fn hides_defensively_on_tahoe() {
        assert_eq!(
            main_window_close_action(true, false),
            MainWindowCloseAction::DefensiveHide
        );
    }

    #[test]
    fn exits_fullscreen_before_the_defensive_hide() {
        assert_eq!(
            main_window_close_action(true, true),
            MainWindowCloseAction::ExitFullscreenThenDefensiveHide
        );
    }

    #[test]
    fn successful_fullscreen_exit_consumes_pending_close_as_defensive_hide() {
        let mut state = FullscreenHideState::default();
        state.begin();

        assert_eq!(
            state.finish(true),
            Some(FullscreenHideCompletion::DefensiveHide)
        );
        assert_eq!(state.finish(true), None);
    }

    #[test]
    fn failed_fullscreen_exit_consumes_pending_close_as_safe_minimize() {
        let mut state = FullscreenHideState::default();
        state.begin();

        assert_eq!(
            state.finish(false),
            Some(FullscreenHideCompletion::Minimize)
        );
        assert_eq!(state.finish(false), None);
    }
}
