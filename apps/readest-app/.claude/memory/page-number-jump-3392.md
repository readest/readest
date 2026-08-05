---
name: page-number-jump-3392
description: "#3392 footer page-number jump: PageJumpInput type-over label (PR #5524), stable-width sizer, jump math per progress style, e2e readingProgress contract moved to the input"
metadata: 
  node_type: memory
  type: project
  originSessionId: f9a874c3-f9a9-4c46-a636-a0b3e8e9fb95
  modified: 2026-08-05T17:13:19.059Z
---

Issue #3392 (jump to a specific page): MERGED via PR #5524 (2026-08-06, e5cff97ca); worktree and branch cleaned up. Device keyboard check (IME vs bottom panel on Android/iOS apps) still pending.

- `footerbar/PageJumpInput.tsx` is ALWAYS an `<input>` styled as the progress label (never click-to-morph): a mobile tap must focus the real input inside the user gesture or iOS never opens the numeric keyboard. Idle needs explicit `bg-transparent` — the UA default input background is white and shows as a phantom pill in dark mode (invisible on light desktop, only dark screenshots catch it).
- Layout stability (user feedback): edit mode keeps the SAME "94 / 251" text and pre-selects just the "94" (`setSelectionRange` in a rAF so the browser's mouse-up doesn't collapse it); typing replaces the selection. An invisible `whitespace-pre` sizer span reserves the width, input is `absolute inset-0`. Percentage style swaps "39%" -> "94 / 251" on focus so the typed number is unambiguous.
- Jump math in `footerbar/pageJump.ts` (pure, tested): reflowable = `goToFraction((n - 0.5) / total)` in foliate "locations" (`pageinfo`, sizePerLoc 1500); fixed layout = `goTo(n - 1)` (FoliateView.goTo widened to `string | number`); reference style = exact `pageList` label -> href, else fraction estimate. `parsePageInput` accepts "120 / 251" (type-over tail). Landing page start can report n-1; e2e asserts |landed - target| <= 1.
- Desktop bar and mobile NavigationPanel BOTH render the input (mobile hidden by `sm:hidden`): e2e `ReaderPage.readingProgress()` parses `input[aria-label="Go to Page"]:visible` — the old `span[title="Reading Progress"]` is GONE.
- Chrome-extension synthetic clicks could not hold focus on the input (focus reverted to foliate-view, typed keys lost) but trusted user clicks and Playwright both work — same lesson as [[tap-toggle-progress-bar-5293]]: verify focus flows with trusted input, don't debug the app from extension click behavior.
- i18n rebase lesson: after a rebase conflict in locale files do NOT re-run `pnpm i18n:extract` mid-rebase — it reset the freshly-merged "Pages" key (#5523) to `__STRING_NOT_TRANSLATED__` across all locales. Surgical fix: `git checkout origin/main -- 'public/locales/*/translation.json'` then script-append only your own key + translations.
- e2e gotcha: on the Alice sample cover page a center tap opens the ImageViewer ([[image-viewer-alt-caption-5232]]); tap ~0.88 height to toggle chrome. `page.mouse.click` does not toggle mobile chrome — use `page.touchscreen.tap` with `hasTouch: true`.
