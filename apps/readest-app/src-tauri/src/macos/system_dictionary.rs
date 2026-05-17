/// macOS native dictionary "Look Up" HUD bridge.
///
/// Renders the small floating definition popover that the system shows
/// for the right-click → Look Up menu item, **without** raising
/// Dictionary.app to the foreground.
///
/// Background — why we DON'T use `NSPerformService("Look Up in
/// Dictionary", …)`: that service is registered by Dictionary.app
/// itself (`NSMessage = doLookupService` in its Info.plist) and its
/// implementation is "bring Dictionary.app to the front and show the
/// word", which is exactly the surface we want to avoid. The actual
/// inline HUD comes from a different AppKit entry point:
///
///     -[NSView showDefinitionForAttributedString:atPoint:]
///
/// We call it on the Tauri window's `contentView` (the WKWebView's
/// host view), positioning the HUD at the view's center. AppKit
/// shifts the popover to keep it on-screen, so the center is a safe
/// default when we can't get a per-selection position from the JS
/// side.
use std::sync::Mutex;

use block::ConcreteBlock;
use cocoa::base::{id, nil};
use cocoa::foundation::{NSPoint, NSRect, NSString};
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use serde::Deserialize;
use tauri::Manager;

/// Optional positional hint forwarded from the JS bridge. Coordinates
/// are in the webview viewport's CSS-pixel space (origin top-left,
/// Y-down) and refer to the **bottom-left baseline** of the selection
/// — that is the same anchor AppKit's
/// `-[NSView showDefinitionForAttributedString:atPoint:]` interprets
/// `atPoint` as, so the HUD label that AppKit re-draws lands on top
/// of the original word instead of being shifted to the right.
///
/// `scale` is the JS `window.devicePixelRatio`. NSView's
/// `showDefinitionForAttributedString:atPoint:` takes view-local
/// points, which on standard Tauri/macOS already match CSS pixels
/// (the WKWebView reports its bounds in points, and the JS viewport
/// is sized in those same points). So `scale` is informational for
/// future tuning — we currently ignore it and treat the JS rect as
/// if already in points. Logged in `info!` so we can revisit if we
/// see drift on Retina hosts.
///
/// `font_size`, `font_family` and `color` describe the typography of
/// the underlying paragraph so we can build an NSAttributedString
/// that visually matches the original word. Without them AppKit
/// falls back to the default 13 pt system font, which is what made
/// our HUD look like a tiny sticky note next to the selection.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupAnchor {
    x: f64,
    y: f64,
    #[serde(default = "default_scale")]
    scale: f64,
    #[serde(default)]
    font_size: Option<f64>,
    #[serde(default)]
    font_family: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

fn default_scale() -> f64 {
    1.0
}

#[tauri::command]
pub fn show_lookup_popover(
    app: tauri::AppHandle,
    word: String,
    window_label: Option<String>,
    anchor: Option<LookupAnchor>,
) -> Result<(), String> {
    let trimmed = word.trim();
    if trimmed.is_empty() {
        return Err("empty word".into());
    }

    // Resolve the target Tauri window. The annotator passes its own
    // label (typically `main` or `reader-<id>`); fall back to `main`
    // if absent so manual invocations from devtools still work.
    let label = window_label.as_deref().unwrap_or("main");
    let window = app
        .get_webview_window(label)
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| format!("window not found: {label}"))?;

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    let ns_window = ThreadSafeNSWindow(ns_window_ptr);
    let owned = trimmed.to_owned();

    run_on_main_thread(move || unsafe {
        // Move the wrapper itself into the closure so the auto-trait
        // checker uses our `Send` impl, then unwrap the pointer.
        let ns_window = ns_window;
        show_definition_for_word(ns_window.0, &owned, anchor.as_ref());
    });
    Ok(())
}

/// SAFETY: must be called on the main thread; `ns_window` must point
/// to a live NSWindow.
unsafe fn show_definition_for_word(
    ns_window: *mut Object,
    word: &str,
    anchor: Option<&LookupAnchor>,
) {
    if ns_window.is_null() {
        log::warn!("[system_dictionary] ns_window is null; skipping HUD");
        return;
    }

    // Resolve `contentView` — a plain NSView that hosts the WKWebView
    // and whose `showDefinitionForAttributedString:atPoint:` we can
    // call. The view exists for the lifetime of the window, so the
    // pointer is safe to use synchronously here.
    let content_view: *mut Object = msg_send![ns_window, contentView];
    if content_view.is_null() {
        log::warn!("[system_dictionary] contentView is null; skipping HUD");
        return;
    }

    let word_ns: id = NSString::alloc(nil).init_str(word);
    let attributed = build_attributed_string(word_ns, anchor);
    if attributed.is_null() {
        log::warn!("[system_dictionary] failed to build NSAttributedString");
        return;
    }

    let bounds: NSRect = msg_send![content_view, bounds];
    // Map JS viewport coords (origin top-left, Y-down) into NSView
    // coords (origin bottom-left, Y-up). When no anchor is supplied,
    // fall back to the contentView's center.
    let point = match anchor {
        Some(a) => {
            // Clamp to view bounds so an off-page selection (e.g. user
            // scrolled away before the command landed) doesn't push
            // the HUD outside its host view.
            let x =
                a.x.clamp(bounds.origin.x, bounds.origin.x + bounds.size.width);
            let y_topdown =
                a.y.clamp(bounds.origin.y, bounds.origin.y + bounds.size.height);
            let y = bounds.origin.y + bounds.size.height - y_topdown;
            log::debug!(
                "[system_dictionary] anchor=({:.1},{:.1}) scale={:.2} → ns=({:.1},{:.1})",
                a.x,
                a.y,
                a.scale,
                x,
                y
            );
            NSPoint::new(x, y)
        }
        None => NSPoint::new(
            bounds.origin.x + bounds.size.width / 2.0,
            bounds.origin.y + bounds.size.height / 2.0,
        ),
    };

    let _: () =
        msg_send![content_view, showDefinitionForAttributedString: attributed atPoint: point];

    // Release our retain on the attributed string. `alloc/init`
    // returns a +1 retained instance and we hold no further reference.
    let _: () = msg_send![attributed, release];
}

/// Build the `NSMutableAttributedString` we hand to AppKit. When the
/// JS side supplies a `font_size` / `font_family` / `color`, we mirror
/// them via NSFont / NSForegroundColor attributes so the small label
/// AppKit re-renders matches the underlying paragraph. Without these
/// attributes AppKit defaults to 13 pt system font and the HUD label
/// looks visibly smaller than the original word — exactly the bug
/// observed before this helper existed.
///
/// SAFETY: must run on the main thread; `word_ns` must be a valid
/// `NSString*` (typically from `NSString::alloc(nil).init_str(...)`).
/// Returns a `+1` retained `NSMutableAttributedString*` — caller is
/// responsible for releasing it.
unsafe fn build_attributed_string(word_ns: id, anchor: Option<&LookupAnchor>) -> *mut Object {
    let mutable_class = class!(NSMutableAttributedString);
    let attributed: *mut Object = msg_send![mutable_class, alloc];
    let attributed: *mut Object = msg_send![attributed, initWithString: word_ns];
    if attributed.is_null() {
        return attributed;
    }

    // Apply font + colour attributes when we have hints. Skipping the
    // attribute when the corresponding hint is missing lets AppKit
    // fall back to its own defaults (still better than a blank label).
    let length: cocoa::foundation::NSUInteger = msg_send![attributed, length];
    let full_range = cocoa::foundation::NSRange::new(0, length);

    if let Some(a) = anchor {
        let font_size = a.font_size.filter(|v| v.is_finite() && *v > 0.0);
        if let Some(size) = font_size {
            // Compensate for the visual gap between a `font-size` in
            // the WKWebView (CSS pixels) and an NSFont of the "same"
            // point size: NSFont's ascender/descender metrics pack
            // glyphs noticeably tighter than WebKit's default
            // line-box layout, so a 16 pt NSFont renders ~85% of the
            // body text's apparent size. Bumping by ~1.15 brings the
            // HUD label back in line with the underlying paragraph.
            //
            // We do NOT divide by `devicePixelRatio` here — both CSS
            // pixels and NSView points are 1:1 on macOS regardless of
            // Retina (Retina just means 1 point = 2 device pixels for
            // both sides), so a /scale would actually *halve* the
            // font on Retina hosts.
            const NSFONT_TO_CSS_PX: f64 = 0.9;
            let scaled = size * NSFONT_TO_CSS_PX;
            let font: id = if let Some(name) = a.font_family.as_deref().and_then(first_family) {
                let name_ns: id = NSString::alloc(nil).init_str(&name);
                let font: id = msg_send![class!(NSFont), fontWithName: name_ns size: scaled];
                let _: () = msg_send![name_ns, release];
                if font.is_null() {
                    msg_send![class!(NSFont), systemFontOfSize: scaled]
                } else {
                    font
                }
            } else {
                msg_send![class!(NSFont), systemFontOfSize: scaled]
            };
            if !font.is_null() {
                let key: id = NSString::alloc(nil).init_str("NSFont");
                let _: () = msg_send![attributed, addAttribute: key value: font range: full_range];
                let _: () = msg_send![key, release];
            }
        }

        if let Some(color_hex) = a.color.as_deref().and_then(parse_css_color_to_rgba) {
            let (r, g, b, alpha) = color_hex;
            let color: id = msg_send![
                class!(NSColor),
                colorWithSRGBRed: r as f64
                green: g as f64
                blue: b as f64
                alpha: alpha as f64
            ];
            if !color.is_null() {
                let key: id = NSString::alloc(nil).init_str("NSColor");
                let _: () = msg_send![attributed, addAttribute: key value: color range: full_range];
                let _: () = msg_send![key, release];
            }
        }
    }

    attributed
}

/// Pick the first font-family token from a CSS `font-family` stack
/// (e.g. `"Source Han Serif", "Noto Serif CJK SC", serif`) and strip
/// its surrounding quotes / whitespace. Returns `None` for the
/// generic-family-only case (`serif`, `sans-serif`, …) so we fall
/// back to the system font instead of asking AppKit to look up a
/// face by an alias it doesn't understand.
fn first_family(stack: &str) -> Option<String> {
    for raw in stack.split(',') {
        let trimmed = raw.trim().trim_matches('"').trim_matches('\'').trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "serif"
                | "sans-serif"
                | "monospace"
                | "cursive"
                | "fantasy"
                | "system-ui"
                | "ui-serif"
                | "ui-sans-serif"
                | "ui-monospace"
                | "ui-rounded"
                | "math"
                | "emoji"
                | "fangsong"
        ) {
            return None;
        }
        return Some(trimmed.to_owned());
    }
    None
}

/// Parse a subset of CSS color forms into normalized sRGB
/// `(r, g, b, a)` values in `[0, 1]`. Supports `rgb(r, g, b)` and
/// `rgba(r, g, b, a)` — the only forms `getComputedStyle` returns
/// for the `color` property in modern WebKit, so we don't need a
/// full CSS-color parser here.
fn parse_css_color_to_rgba(input: &str) -> Option<(f32, f32, f32, f32)> {
    let trimmed = input.trim();
    let inner = trimmed
        .strip_prefix("rgba(")
        .or_else(|| trimmed.strip_prefix("rgb("))
        .and_then(|s| s.strip_suffix(')'))?;
    let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
    if parts.len() < 3 {
        return None;
    }
    let r = parts[0].parse::<f32>().ok()? / 255.0;
    let g = parts[1].parse::<f32>().ok()? / 255.0;
    let b = parts[2].parse::<f32>().ok()? / 255.0;
    let a = if parts.len() >= 4 {
        parts[3].parse::<f32>().ok()?
    } else {
        1.0
    };
    Some((
        r.clamp(0.0, 1.0),
        g.clamp(0.0, 1.0),
        b.clamp(0.0, 1.0),
        a.clamp(0.0, 1.0),
    ))
}

/// Thread-safety wrapper for an `NSWindow*`. Tauri's command handler
/// thread isn't necessarily the main thread, so we hand the pointer
/// through to the main-thread block via this wrapper. Use only with
/// pointers obtained from `Window::ns_window()` while the window is
/// still alive.
struct ThreadSafeNSWindow(*mut Object);
unsafe impl Send for ThreadSafeNSWindow {}
unsafe impl Sync for ThreadSafeNSWindow {}

/// Run `f` on the main thread. Synchronously when already on the main
/// thread; otherwise enqueued on `NSOperationQueue mainQueue`. AppKit
/// requires NSView calls (and most NSWindow accessors) to run on the
/// main thread.
fn run_on_main_thread<F>(f: F)
where
    F: FnOnce() + Send + 'static,
{
    unsafe {
        // The cocoa crate exposes `-[NSThread isMainThread]` as Rust
        // `bool`, not the C BOOL — match that here.
        let is_main: bool = msg_send![class!(NSThread), isMainThread];
        if is_main {
            f();
            return;
        }
        // `ConcreteBlock` requires the closure to be `Fn`, but we
        // need `FnOnce` semantics for the move-out. Wrap in a
        // `Mutex<Option<F>>` so the block body can take it on first
        // invocation; NSOperationQueue only runs the block once, so
        // the unwrap-or-skip pattern is safe.
        let once = Mutex::new(Some(f));
        let block = ConcreteBlock::new(move || {
            if let Ok(mut guard) = once.lock() {
                if let Some(callable) = guard.take() {
                    callable();
                }
            }
        });
        let block = block.copy();
        let queue: *mut Object = msg_send![class!(NSOperationQueue), mainQueue];
        let _: () = msg_send![queue, addOperationWithBlock: &*block];
    }
}
