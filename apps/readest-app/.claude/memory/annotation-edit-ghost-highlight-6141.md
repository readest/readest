---
name: annotation-edit-ghost-highlight-6141
description: "MERGED #6357 (0f2ad23ec) — #6141 ghost highlight after adjusting+deleting = draw effect repaints the SAVED pre-drag cfi on a mid-drag relocate; PR #6357 seq guard does NOT fix it; Playwright phone-emulation recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 9195259f-abea-4114-b3e0-8b17c5aa2fe5
  modified: 2026-09-24T01:27:42.446Z
---

#6141 (Android, "fake untappable highlight left after adjusting a highlight a few times then deleting it") — root cause CONFIRMED in Chromium 2026-09-24, fix MERGED 2026-09-28 as #6357 (0f2ad23ec): maintainer commit 5453e88a6 pushed on top of the contributor's seq-guard commit (guard kept, harmless). NOT device-verified. Xiaomi left with an instrumented devtools APK + `svc power stayon true` (it dropped off USB mid-session) — reinstall a normal build and `adb shell svc power stayon false` when reconnected.

**Mechanism:** `useAnnotationEditor.applyAnnotationRange` only removed its own previous preview (`editingAnnotationRef.current`). While a handle is held the saved record keeps the PRE-drag cfi (drags don't persist), and Annotator's draw effect (`[progress, annotationIndex, translationEpoch]`) repaints saved records on every relocate (corner auto-turn, resize). So a relocate mid-drag re-adds the pre-drag range; nothing ever removes it; delete removes only the committed cfi. Ghost is untappable because overlayer hitTest returns a cfi no record owns (`onShowAnnotation` early-returns). Fix = also `removeBookNoteOverlays(v, existingAnnotation)` when its cfi differs from the preview's.

**PR #6357 (contributor, seq-number guard on the await) does NOT fix it** — re-ran the repro with its guard applied, ghost remained. Its race can't happen in prod anyway: `getAnnotationText` only runs the `punctuation` transformer (microtask), foliate `resolveNavigation` is sync, `Overlayer.add/remove` are keyed + idempotent.

**Ruled out:** loupe (clones body text only, not the overlay SVG); stored booknotes carrying a stale `value` (all `value:` sites are copies; wrapper is `{ value: note.cfi, ...note }`).

**Chromium phone-emulation recipe (when the Xiaomi is unavailable):** `pnpm dev-web -p 3007` in the worktree + a Node Playwright script (`node_modules/playwright` in the app) with `launchPersistentContext(profile, {isMobile, hasTouch, viewport 412x860, userAgent: Android})` — the Android UA flips web `appService.isMobile`. Import via Import Books → "From Local File" + `filechooser`. Headless CDP touch long-press does NOT select text: select programmatically, then dispatch `pointerup`/`touchend` on the section doc to raise the toolbar. Taps: `page.touchscreen.tap`; handle drags: raw `Input.dispatchTouchEvent` start/move/end. Taps in the left/right third turn the page — keep targets mid-screen and re-page the target on-screen before each step. Force a mid-drag relocate with `renderer.next(); renderer.prev()` between touchMoves. Overlay truth = instrument `Overlayer` ctor to register `globalThis.__ovls` + expose `#map` keys.

**Chrome-extension traps hit:** screenshot frame (1568x774) ≠ CSS px (1280x632), scale clicks by ~1.225; the extension repeatedly lost the tab ("Couldn't determine which page") — Playwright was far more reliable. A mis-scaled click can land on a freshly mounted handle and start a runaway drag (every later hover extends the range).

Related: [[annotator-overlay-z-layers]], [[feedback-always-verify-on-xiaomi]].
