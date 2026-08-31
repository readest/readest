---
name: library-reader-theme-scope-5945
description: Library and reader carry separate theme mode/color; the store seams that made it small, and the derived-state trap
metadata:
  type: project
---

#5945 — the library and the reader now carry separate theme mode + color.
MERGED as #5948 (squash `ad9e5c1b8`, 2026-08-29); worktree/branches cleared.
Came from Reddit, filed by chrox as [[reddit-feature-requests]] fodder.

**Two seams made this a small change — find them before touching theme code:**

- `getThemeCode()` (`src/utils/style.ts`) reads the `themeMode`/`themeColor`
  localStorage keys directly, and **every one of its consumers lives under
  `src/app/reader/`**. So it is already "the reader's theme" by usage. Keeping
  the reader pair on the original keys meant `getThemeCode()` needed *zero*
  changes and all book-content styling followed for free.
- `useTheme()` (`src/hooks/useTheme.ts`), not the store, is where `data-theme`
  actually lands on `documentElement` for every route. It gained a
  `themeScope` prop; only `Reader.tsx` passes `'reader'`. Every other route
  (library, OPDS, player, auth, user) shares the library's scope so none
  paints a third look.

**Storage:** `libraryThemeMode` / `libraryThemeColor` in localStorage, absent =
inherit. NOT `SystemSettings` — theme has never lived there, and putting only
the library half in settings would make one scope sync and the other not.
Mirrors the undefined-means-inherit semantics of `libraryBackgroundTextureId`
(#4743/#5306) without importing its storage location.

**Decoupling rule (chrox's call):** while the library inherits, every quick
toggle writes the *shared* value and both pages move together — byte-identical
to pre-#5945. Only picking a library value in Settings → Theme decouples. This
is why the quick toggles needed no call-site changes at all.

## Traps

- **`themeMode`/`themeColor` in the store are now DERIVED** (resolved for the
  active scope). Anything that `setState`s them directly is silently ignored —
  that is exactly how 5 existing theme-store tests broke; they now seed
  `readerThemeMode`/`systemIsDarkMode` instead. Same trap awaits future tests.
- **Partial key states are reachable.** A quick toggle writes only *one* key,
  so `themeMode` set + `themeColor` absent is normal. `loadDataTheme` must
  treat a library-only override as configured, and resolve the reader pair via
  `getInitialThemeMode()`/`getInitialThemeColor()` — gating on both reader keys
  skips the first paint (flash); using the raw values yields a literal
  `null-light` in the attribute. CodeRabbit caught the first half on #5948; its
  proposed patch would have caused the second half and broken the two tests
  that pin "do nothing when nothing is configured".
- Editing the scope you are NOT looking at must never repaint the current page
  or churn `themeCode` — same rule the background texture scope follows.

## Unrelated pre-existing bug found while verifying

`InvalidStateError: Transition was aborted because of invalid state` fires on
every library→reader client-side navigation (next-view-transitions). A/B
confirmed by stashing the branch: it reproduces identically on base `main`.
NOT from #5945, no issue filed yet. Don't chase it as a regression.

Related: [[eink-per-device-css-data-eink-5795]],
[[daisyui-v5-tailwind-v4-migration]]
