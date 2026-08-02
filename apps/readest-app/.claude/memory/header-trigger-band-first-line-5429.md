---
name: header-trigger-band-first-line-5429
description: "#5429 first line unselectable on Android - HeaderBar's invisible 44px hover trigger sits over the text when the page header is off; mobile must not take pointer events there"
metadata:
  type: project
---

#5429 "Unable to highlight the first line of a page" (Android, reproduced on a
Boox Leaf5 2026-08-02). MERGED as #5432 (`b17f06186`).

**Root cause:** `HeaderBar.tsx` renders an invisible hover trigger
(`absolute top-0 z-10 h-11 w-full`, `onClick` -> show header). `h-11` = 44px is
exactly `marginTopPx: 44`, the content top margin *when the page header is on*,
so with the header on the trigger stops right where text starts and nothing
looks wrong. Turn the page header off and `getViewInsets` switches to
`compactMarginTopPx: 16` (`src/utils/insets.ts`), so the first line renders at
y~20 INSIDE the 0..44 trigger, which swallows the touch: no selection, no
annotation popup. Only `pointerInDoc` disabled the trigger before.

**Fix:** `(isMobile || pointerInDoc) && 'pointer-events-none'` with
`isMobile = appService?.isMobile || window.innerWidth < 640` - exactly what
`footerbar/FooterBar.tsx` already does for its own bottom trigger. Mobile has no
hover and toggles the bars via the page tap (`usePagination` center band, or any
tap when `disableClick`), so nothing is lost. Desktop keeps hover + click.

**Verification (device, not jsdom** - see [[feedback-no-mock-only-platform-tests]]):
`document.elementsFromPoint(w/2, 10)` returned the trigger before and
`foliate-view` after; the same `input swipe x y x y 700` long press went from
nothing to selecting a word + `.selection-popup`. New e2e case
`src/__tests__/android/top-band-selection.android.test.ts`.

**Android CDP lane gotchas learned here:**
- `renderer.setAttribute('margin-top', '16px')` forces page-header-off geometry
  at runtime, so the test needs no `run-as`/settings patch and runs on release
  builds. The override sticks (React does not re-apply it).
- Assert `.selection-popup`, NOT a DOM selection: with the instant-highlight
  quick action on (the reporter's setup, and this device's) the hold annotates
  instead of selecting, so a selection assertion is config-dependent.
- A chapter's opening page starts with a heading well below the band - page
  forward until `firstLine.cssY < 44`, and assert that premise in the test.
- Inline `el.style.pointerEvents = 'auto'` on the trigger re-creates the bug on
  an already-fixed build (React never rewrites that node's style), which is how
  the test was proven to discriminate. It also SURVIVES opening another book,
  so clear it or force-stop before believing a later run.
- Running the whole lane back to back poisons shared device state
  ("no hyphenated on-screen paragraph found"); force-stop between files.
  The corner-dwell case in `selection.android.test.ts` fails on this Boox with
  and without the fix (pre-existing, e-ink refresh).
- `pnpm dev-android` from a worktree reinstalls over the user's app without data
  loss: `pnpm worktree:new` symlinks `gen/android/keystore.properties`, so the
  signature matches and `adb install -r` keeps the library.

Related: [[android-cdp-e2e-lane]], [[android-e2e-local-repro-workflow]],
[[android-system-selection-menu-one-off]]
