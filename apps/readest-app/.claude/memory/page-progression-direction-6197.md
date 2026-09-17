---
name: page-progression-direction-6197
description: "#6197 book-level page-progression-direction: multicol column order comes from body not <html> (CSS Writing Modes 8.1); precedence is user writingMode > spine > document > UI language"
metadata:
  type: project
---

PR #6197 (JackyHe398) + foliate-js #95. Reviewed and fixed 2026-09-17; pushed
`d43bb35f5` to their fork `main` and force-pushed foliate `1286eb3` (rebased
off `9e05bf2` onto `b9dcd03` — the original pin **dropped foliate #96**, the
image-clamp batching from [[duokan-footnote-image-clamp-thrash-6155]]).
**Android-VERIFIED by chrox on the Xiaomi 13 (2026-09-17)** with the
reporter's `01 冰菓.epub` (spine `rtl`; cover/title/message/logo horizontal-tb
LTR, introduction onward vertical-rl).

**It is NOT a contradiction with #4069 / foliate-js #13** ("mixed writing modes
in adjacent sections"). That one is the *writing-mode* axis (destroy non-primary
views when `vertical` flips). #6197 pins only the *rtl/progression* axis, and
`view.js goLeft/goRight` already resolved left/right from `book.dir` book-wide.

**The load-bearing CSS fact.** In an HTML document the principal writing mode —
the one the ROOT element's own box uses, and with it the order of its column
boxes — is taken from `body`, NOT from the root (CSS Writing Modes §8.1).
`setStylesImportant(doc.documentElement, {direction: 'rtl'})` alone measurably
does nothing to column order (verified in Chromium: `deDir: rtl`, columns still
LTR). Put the progression on `body` and hand the content back its own direction
with `body > *:not([dir]) { direction: <authored> }`.

**Why the columns must follow the progression at all.** One scroll container
holds several sections' views, so `dir` cannot be per-document. With
`dir="rtl"` on the container and LTR columns inside the iframe, the section
opens on its LAST page AND `expand()` computes
`contentStart = rootRect.right - contentRect.right` hugely negative, so
`pageCount` collapses to 1 (`scrollWidth === clientWidth`). That collapse is a
**false-pass trap**: "first paragraph is on screen" passes for the wrong
reason. Always assert `renderer.pages > 1` too.

**Precedence (readest `getPageProgressionRTL` in `libs/document.ts`):**
user `writingMode.includes('rl')` → spine `ltr`/`rtl` → document → UI language.
The PR's version let `bookDoc.dir === 'ltr'` beat the user's Vertical (RL)
choice, which silently broke `viewPagination`'s left/right swap, the reading
ruler's column mapping, the progress bar and the paginator's vertical
drag-follow `forwardSign`.

**`viewSettings.rtl` is triple-duty** — progression (`viewPagination`,
`ProgressBar`), column order (`ReadingRuler`), and popup side
(`FootnotePopup`). Making the columns follow the progression is what keeps all
three coherent; don't pin `rtl` book-wide without also turning the columns.

**Gotchas hit:**
- A `View` outlives its documents: a `<style>` kept in a field is detached by
  the next section. Guard with `styleEl?.ownerDocument !== doc`.
- `flow` changes call `render()` on the SAME document, so a paginated-mode
  inline `direction` override survives into scrolled mode unless cleared.
- Vertical writing paginates along `scrollTop` with host `dir` forced `ltr`;
  `direction` there picks the line-stacking axis, so never override it.
- Synthetic paginator book for browser tests: `{ dir, sections: [{ load: () =>
  blobURL, unload, size }] }` — no EPUB fixture needed.

**Android dev-build gotchas (from the verify):** a PR branch behind `main`
builds a LOWER versionCode (0.12.8 = 12008) than the installed release, and
`adb install -r -d` still refuses a downgrade on a non-debuggable release APK.
Don't uninstall (wipes the real library); bump `apps/readest-app/package.json`
version locally, uncommitted. The worktree also needs `packages/tauri` and
`tauri-plugin-webview-upgrade` submodules plus `pnpm tauri android init` +
`git checkout` of the tracked gen files. A scratch `*.android.test.ts` breaks
`pnpm build`'s type check. `openFixtureBook`'s "content rendered" probe can pass
on the LAST-OPEN library book; check `view.book.dir`/title before probing.

Also restored in that push: `insets.test.ts` (the PR wiped the #5303/#4977/#4089
suites; CI stayed green because the tests vanished) and `flake.lock`.
Related: [[worktree-new-rebases-pr-force-push]], [[css-style-fixes]].
