---
name: traffic-lights-library-orphan-hide-6222
description: macOS traffic lights missing on the library page (#6222) - the reader's deferred hide timer outlived its unmount, and NSWindow.setTitle resets the title-bar layout; plus how to measure and drive the native buttons
metadata:
  type: project
---

**#6222 macOS traffic lights missing on library.** Two defects, both in
`src/app/reader`/`src/utils`, none in Rust.

1. **Orphan hide timer.** `HeaderBar`'s deferred hide was a bare
   `setTimeout(..., 100)` with no cleanup. Closing the last book writes
   `hoveredBookKey = null` (WindowButtons' `onClose`) and *then* routes to
   the library, so the timer came due after `LibraryHeader` had asked for the
   buttons — and hid them there. Fix = `clearTimeout` in the effect cleanup.
   Invoke sequence proved it: `true` (reader) → `true` (library) → `false`
   (orphan). The timer body is gated on `!getIsSideBarVisible()`, which is why
   an open sidebar masked it.

2. **`NSWindow.setTitle` resets the title bar.** Both the library page and
   `BooksGrid` call `tauriSetWindowTitle()` on mount. A new title makes AppKit
   re-lay out the title bar and restore the standard 28pt container, dropping
   the buttons to their default 6pt below the window top (ours is 14 for the
   44pt header) — or bringing them back on screen where the reader had parked
   them off the top. That raced each page's own traffic-light push: the
   "position jumps by several pixels" report. **Diagnostic tell:** offset 6 =
   the pristine AppKit default; a window resize snapping it back to 14 means
   the Rust statics are right and only the re-apply was missing.

   Fix = Rust command `set_window_title` (traffic_light.rs): sets the NSWindow
   title via cocoa and calls `position_traffic_lights` **in the same
   main-thread closure**, so the default layout is never painted.
   `tauriSetWindowTitle` invokes it when `hasTrafficLight`. A JS-side
   re-assert after `setTitle` resolved was NOT enough — it lands one IPC
   round-trip later, after AppKit has painted a frame at the default, and
   chrox still saw the flick. Any correction that crosses the IPC boundary
   will flicker; it has to be same-pass. Verified by chrox on device.

**Native geometry (measured, macOS 26):** rendered offset below the window top
is exactly `(header_h - btn_h) / 2`. Close button is `(10, 6, 14x16)`, and a
full hide→show cycle leaves that frame untouched — AppKit does *not* squash
or re-inset the buttons when we resize the container, so don't go hunting
there. Hidden = container 0-high, buttons ~22px above the window top (the
"buttons exist in the AX tree but are invisible" report).

**Dead ends (do not repeat):** deduping identical IPC pushes in the store
made things WORSE — those repeated pushes were the only thing re-asserting
the layout after the title reset. An `NSViewFrameDidChangeNotification`
observer on the title-bar container did not catch the reset either (the
relayout appears to replace the container view, so the observer watches a
dead object).

**Measuring without a screenshot** (a `cargo run` binary has no bundle id, so
computer-use screenshots filter it out; the AX tree is cheaper anyway):

```sh
osascript -e 'tell application "System Events" to tell process "Readest"
  set wp to position of window 1
  set cp to position of button 1 of window 1
  return (item 2 of cp) - (item 2 of wp)
end tell'
```

**Dev-loop traps hit here** (all cost real time):
- Port 3000 may already be serving `pnpm dev-web` (`.env.web`); then the
  Tauri window loads the **web** build where `hasTrafficLight` is `false` —
  buttons at Rust's static default with no `pl-16` on the header, which looks
  exactly like a padding bug. Check `NEXT_PUBLIC_APP_PLATFORM` first.
- Next 16 refuses a second dev server from the same directory, whatever the
  port, so you must stop theirs to run `pnpm dev`.
- Switching a running dev server between `.env.web` and `.env.tauri` leaves
  `.next` poisoned: every route 404s until `rm -rf .next`.
- Synthetic clicks (`System Events click at`) reach menus fine, but a click on
  a bookshelf cover opens Book Details, not the book, and the reader's hover
  header never reveals. To get into the reader, flip `openLastBooks` in
  `~/Library/Application Support/com.bilingify.readest/settings.json` (back
  the file up; the app rewrites it on quit) and relaunch.

See [[bug-patterns]], [[layout-ui-fixes]], [[annotator-overlay-z-layers]].
