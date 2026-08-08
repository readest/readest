---
name: window-title-book-name-a11y-5547
description: "Window title = 'Readest - <Book>' for Alt+Tab/screen readers (PR #5547 MERGED); macOS Overlay title bar DRAWS the title, so titleVisibility=hidden keeps it invisible without blanking AXTitle; #5547 shipped WITHOUT the set-title ACL grant so every setTitle threw"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9d293ac4-41e7-4c2f-accf-b6a7b26e7e1b
  modified: 2026-08-08T14:35:05.949Z
---

Windows Alt+Tab announced only "Readest", so blind users could not tell two
open books apart. MERGED #5547 (`d1749feee1`): `tauriSetWindowTitle(bookTitle)`
in `src/utils/window.ts`, called from the BooksGrid effect that already set
`document.title` (follows `sideBarBookKey`, i.e. the active book), and reset to
plain `Readest` by a `hasWindow` effect in `src/app/library/page.tsx`.

**#5547 shipped denied by the ACL** (fixed by #5578, `7e07e1b40`). Opening a book threw
`Unhandled Promise Rejection: Command plugin:window|set_title not allowed by
ACL` on every desktop platform: the PR touched 8 files and none of them was
`src-tauri/capabilities/default.json`. **`core:window:default` grants only the
GETTERS** (`allow-title` reads the title; also `allow-is-*`, `allow-inner-size`,
...). Every mutating window command needs its own line, which is exactly why
`allow-close` / `allow-set-size` / `allow-set-fullscreen` / ... are enumerated
one by one there. Fix = add `"core:window:allow-set-title"`.

Tells and traps:
- The unit tests around `tauriSetWindowTitle` mock `@tauri-apps/api/window`, so
  they pass while the real command is denied — mocked IPC can never see an ACL
  gap ([[feedback-no-mock-only-platform-tests]]). Both call sites are
  fire-and-forget (`tauriSetWindowTitle(...)` unawaited), so the denial surfaces
  only as an unhandled rejection.
- Validate an identifier by *building*: `cargo check -p Readest` runs Tauri's
  `build.rs`, which hard-errors on an unknown permission string. `src-tauri/gen`
  is **gitignored**, so never write a test that reads `acl-manifests.json` /
  `*-schema.json` — they don't exist in CI before a Tauri build.
- `default.json` has no `platforms` key, so one grant covers desktop + mobile.

**The macOS trap.** `TitleBarStyle::Overlay` does NOT hide the title text —
in the vendored runtime (`packages/tauri/crates/tauri-runtime-wry/src/lib.rs`
~1115) it only sets `with_titlebar_transparent(true)` +
`with_fullsize_content_view(true)`. AppKit still draws the title string
centered over Readest's own header, which is why `lib.rs` and `nav.ts` shipped
`.title("")` on macOS only. Fix = a `macos::window::init()` plugin whose
`on_window_ready` sets `titleVisibility = .hidden` (covers JS-created reader
windows too), after which every platform can pass a real `"Readest"` title.

`titleVisibility = .hidden` does **not** blank `AXTitle` — verified with a
standalone AppKit probe (two NSWindows, `.visible` vs `.hidden`, same title;
System Events read both names back). So VoiceOver / Mission Control keep the
name while the title bar renders blank.

**Verifying on macOS, gotchas that cost most of the time:**
- `pnpm dev-macos` `open`s the bundle, but **single-instance hands the launch
  to any already-running Readest** — check `ps -p $(pgrep -x readest) -o
  lstart,command` before trusting a probe, or you are reading yesterday's
  build (the process is `readest`, not `Readest`).
- Read the a11y title exactly as a screen reader does, no GUI needed:
  `osascript -e 'tell application "System Events" to tell process "readest"
  to get name of every window'`.
- `open "readest://book/<hash>"` does NOT open a book — `readest://` is also
  the OAuth callback scheme, and the URL lands the app on `/auth`, which then
  **persists across relaunches**. Recovering needs a click on the in-app back
  arrow. Don't use it to script a book open.
- Opening a book without the mouse stayed unsolved; the BooksGrid effect is
  covered by unit tests only. See [[browser-verify-readest-web-recipe]] for the
  web-side equivalent (`hasWindow` is false there, so this path never runs).

Related: [[worktree-shared-target-stale-plugin-cache]] (ran after removing the
PR worktree; 27 packages needed `cargo clean -p`).
