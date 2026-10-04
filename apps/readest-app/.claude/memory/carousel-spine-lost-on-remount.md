---
name: carousel-spine-lost-on-remount
description: Skeuomorphic spine vanished on carousel covers scrolled back into view; mount-effect reset raced a cached image's onLoad
metadata:
  type: project
---

Carousel shelves (`BookshelfCarousel`, windowed: slides unmount/remount on horizontal scroll) lost the `.book-spine` on remounted covers. Cause: `BookCover` reset `imageLoaded` in `useEffect([coverImageUrl])`, which also runs on MOUNT; a cached cover's next/image `onLoad` (decode promise) can land before the passive mount effect, so the effect flips it back to false forever (`data-loaded-src` dedupe means no second load). Fix MERGED #6624 (b3c671489) 2026-10-04, UNRELEASED: reset during render via a `prevCoverImageUrl` state compare. Unit test mocks next/image with a ref that calls onLoad on attach.

**Repro traps:** programmatic `scrollLeft` jumps and CDP `Input.synthesizeScrollGesture` did NOT reproduce; real `adb shell input swipe 900 600 200 600 150` loops did (5/9 covers flat). Fixed build: 126 remounts, 0 flat (Xiaomi 13). Recorder: MutationObserver on the carousel logging spine class + img load events into `window.__log`.

**Same session follow-ups (all MERGED in #6624, b3c671489):** BookItem `coverAspect` had the identical mount-effect race (fit covers kept the 28/41 cell, so spine + selection wash spilled past the image); Rename Group was always disabled because selecting a group tile stores its book hashes, never the group id (now `findSelectedManualGroup` matches a folder tile by `id === md5Fingerprint(name)` + exact book set); Recently read default = own grouping, `groupBy: 'none'` (only reaches unmigrated libraries, rows are frozen by `migrateBookshelfSettings`); Virtuoso mounts its Footer before any row, so the Import Books footer flashed at the top on load and on return from the reader (gate on `itemsRendered`), and the footer lacked `transform-wrapper` so it ignored the bottom rubber band.

**Device traps:** a stalled `curl`/CDP = the Xiaomi dozed behind the keyguard; `input keyevent KEYCODE_WAKEUP` + `wm dismiss-keyguard` recovers it, `svc power stayon usb` during tests (reset to false after). Cold-load flash recorder: `Page.addScriptToEvaluateOnNewDocument` rAF logger + `Page.reload`; for the reader return, a `Runtime.evaluate` recorder survives the client-side route change.

**Reader -> library transition (same session):** closing tore the book down BEFORE navigating (blank reader, loading dots, empty shelf ~250ms, then a hard cut). Fix = `transitionAway(leave, arrived, 'back')` in `utils/viewTransition.ts`: start the view transition first, close + navigate inside the update callback, end the hold when `.bookshelf` mounts. Traps: Virtuoso rows can NEVER render during the hold (rendering paused, no ResizeObserver) so waiting for `[data-page-row]` burns the whole cap (1.2s lag measured); Android back uses `router.back()` to `/`, not `/library`, so a pathname check never matches. Measure with CDP `Page.startScreencast` (frame-rate capture incl. transition) + a setTimeout-polled page logger wrapping `document.startViewTransition`.

**Rename flattening follow-up MERGED #6625 (53b438055):** rename itself kept `A/B` -> `Z/B`, but the dialog stayed open and Confirm moved the whole selected subtree (a group tile selects every nested book) into one group. Save now closes the dialog. Not device-tested (would rename groups in a synced library).
