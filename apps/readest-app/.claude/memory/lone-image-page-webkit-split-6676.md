---
name: lone-image-page-webkit-split-6676
description: "#6676 follow-up: page-height cover split across columns only in WebKit; lone-image fix (#7794 MERGED); WebKit vitest + Tauri webdriver recipes"
metadata:
  node_type: memory
  type: project
  originSessionId: cecd0803-0416-4020-843a-b003b92988df
  modified: 2026-11-22T10:34:43.682Z
---

A section with one image and no text has the image clamped to the page height, but Readest's
`p { margin-top: paragraphMargin }` plus the inline image's line descent made the line taller
than the page. WebKit slices the overflow into the next column (cover cut, not centred);
Chromium moves monolithic content whole. Fixed in #7794 (9821721b9): `applyImageStyle` marks
`.lone-image` (text check skips svg title/desc/metadata/style/script); paginated CSS zeroes
ancestors' margin-block-start and sets `vertical-align: top`.

2026-11-22 follow-up: the reporter's mid-chapter page-tall images (`<p><img height="100%"/><br/></p>`)
are still sliced in WebKit (6/16 in Chapter04 of the Sondheim EPUB, 0 in Chromium). Any line-descent
removal fixes them: `img:not(.has-text-siblings) { vertical-align: top }` (both engines, costs ~5.4px
under every standalone image) or WebKit-only `-webkit-line-box-contain: replaced` on their parent.
The `:has(.lone-image)` margin rule is still needed: a cover in a `<p>` fails in Chromium too without it.
Engine rule (plain HTML, no Readest CSS): WebKit never moves an unbreakable line or block taller than
the page; it leaves it in place and splits it. Chromium moves it to the next column and drops the
overflow. No CSS property changes this, so the fix has to keep such lines at or under one page.
Repro harness (untracked): worktree readest-fix-webkit-image-slice, src/__tests__/tmp6676/.

**Why:** reporter on #6676 saw it only on macOS; Chrome hid it.

**How to apply:**
- Layout bugs "only on Safari/macOS/iOS": measure `getClientRects()` of the img/p in the
  WKWebView. Two rects = WebKit slicing an overflowing line.
- WebKit browser tests: the config has only a chromium instance and `--browser.name=webkit`
  errors. Use a throwaway `vitest.webkit.local.mts` that imports `vitest.browser.config.mts`
  and sets `test.browser.instances = [{ browser: 'webkit' }]` (Playwright webkit is installed).
- fixed-layout.js has no `setStyles`, so `getStyles` rules never reach FXL pages.
- Tauri webdriver `POST /window/rect` takes physical px (2x) and sometimes ignores the request
  when x/y are included; send width/height only and confirm with `innerWidth`/`innerHeight`.
- `~/dev/readest/target` is a symlink to an external SSD; when it isn't mounted, drop
  CARGO_TARGET_DIR and build in the worktree (about 10 min cold). See [[desktop-dev-window-webdriver-recipe]].
- After `pnpm worktree:rm`, re-run `git submodule init <path>` for each `-` entry in the main
  checkout ([[worktree-submodule-deinit-shared-config]]).
