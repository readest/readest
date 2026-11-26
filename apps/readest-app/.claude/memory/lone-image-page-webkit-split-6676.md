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

2026-11-22 follow-up, #7804 MERGED (58a60258b): mid-chapter page-tall images
(`<p><img height="100%"/><br/></p>`) were still cut in WebKit (6/16 in the Sondheim EPUB's Chapter04).
WebKit never moves an unbreakable line or block taller than the page; it splits it where it falls
(Chromium moves it and drops the overflow). No CSS changes that, so the line must fit. Fix, WebKit only
via `@supports (-webkit-line-box-contain: replaced)`: `img.alone-on-line:not(.has-text-siblings)` gets
`vertical-align: top` plus `:where(...) { margin-block-end: -1px }`. The -1px is needed because a block
ending exactly on a page boundary makes WebKit carry the next margin onto the next page (blank page
between two page-tall images); ending 1px early lets WebKit truncate it like Chromium.
`alone-on-line` comes from `hasTextOnLine` in applyImageStyle: computed `display` boundaries, scans
inside inline siblings up to the first `<br>`, skips display:none, a break closes that direction.
CodeRabbit found 4 gaps in earlier versions (link climb, inline div, span-with-br, hidden br).
`-webkit-line-box-contain: replaced` on the paragraph was rejected: it collapses caption lines.
`:has(.lone-image)` margin rule still needed (Chromium too). happy-dom reports unset display as ''.

2026-11-23 third case (reporter confirmed fixed, issue CLOSED; owner replied, no draft pending), readest #7828 MERGED e6eb1f528 (at reviewed head ec0ad6bd7, pins foliate a8c708f
on `fix/section-start-image-on-pin`: keep that branch); foliate #189 MERGED ca7b055 (in-flow + restyle refit); pin a8c708f = foliate main ca7b055 + the same
off-main extras as before; foliate-js #187 MERGED 020137b (at head 2f25a65) + #188 MERGED 44503d7
(the out-of-flow fix pushed seconds after #187 merged); readest submodule on `fix/section-start-image-on-pin` a8c708f: a captioned plate that OPENS its section (`div.wrap > p.image{margin-top:1em} > img` + caption
`<p>`). At a section start nothing absorbs the margin, so the page-height clamp ends 1em past the page:
WebKit cuts it, Chromium moves it to page 2 and leaves page 1 blank. After text both engines truncate the
margin at the break, so mid-chapter plates were fine. Fix in foliate `setImageSize` (runs every render, so
resize/font changes re-measure): first image with no text before it (style/script text ignored), sum of
collapsed top margins + borders + paddings of its blocks + its own margin-top; only if height + that >
available height, clamp shorter by it and inline `vertical-align: top` (Chromium's baseline descent
otherwise pushes it again); the next render restores the inline value + priority (`#topAligned`).
A block with its own formatting context (display not block/list-item, overflow not visible/clip) ends the
margin-collapsing run; margins collapse as max positive + min negative; text before the image counts only
if it has client rects (hidden headings, <style>); `first` = first of els with client rects. The page-tall
check runs AFTER the clamp writes (one extra layout, only when leading > 0): a book's
`max-width: none !important` made the pre-clamp height page-tall though the width clamp keeps it short.
Don't scale height by width ratio: explicit heights keep their box (object-fit contain). CodeRabbit, 4 passes. A shown in-flow block before the image -> no fit (engines move it whole); positioned/
floated siblings skipped: the reader's `#readest-skip-link-last-pos` (absolute 1px, first child of every
section body, from handleA11yNavigation) defeated the fix in the app while the browser test passed. The
test harness doesn't add it: re-run the real app after any change to the "opens its section" rule.
Declined: skipping `.lone-image` (a cover with its own margin-top is cut in WebKit on main's paginator).
Pass 5/6 (foliate #189): `inFlow()` gates text, preceding blocks and the opening image; block-level image
margin joins the collapse run. Paginator.setStyles does NOT re-run setImageSize (only expand), so the fit
moved into View#fitOpeningImage/#unfitOpeningImage + public refitOpeningImage() called after fontsReady;
verified with Cmd+= (zoom-in = defaultFontSize) over webdriver key actions (\uE03D = Meta).
CodeRabbit auto-pauses after many commits: request each new head with `@coderabbitai review`. Chromium treats an `overflow: hidden` box as unbreakable: plate +
caption inside one moves whole to the next page however the image is sized. Rejected: zeroing margins
of every section-opening image (moves small chapter ornaments), measuring in applyImageStyle (load fires
before columnize, and settings changes would leave it stale).

**Why:** reporter on #6676 saw it only on macOS; Chrome hid it.

**How to apply:**
- Layout bugs "only on Safari/macOS/iOS": measure `getClientRects()` of the img/p in the
  WKWebView. Two rects = WebKit slicing an overflowing line.
- WebKit browser tests: `pnpm test:browser:webkit` (#7807 MERGED 67dcb500b) runs the files listed in
  `vitest.browser.webkit.config.mts` in WebKit; CI's test_web_browser runs it after Chromium. List a test
  there when it checks a WebKit-only rule. Proved on CI by a DO NOT MERGE commit that dropped the CSS.
- fixed-layout.js has no `setStyles`, so `getStyles` rules never reach FXL pages.
- Tauri webdriver `POST /window/rect` takes physical px (2x) and sometimes ignores the request
  when x/y are included; send width/height only and confirm with `innerWidth`/`innerHeight`.
- `~/dev/readest/target` is a symlink to an external SSD; when it isn't mounted, drop
  CARGO_TARGET_DIR and build in the worktree (about 10 min cold). See [[desktop-dev-window-webdriver-recipe]].
- After `pnpm worktree:rm`, re-run `git submodule init <path>` for each `-` entry in the main
  checkout ([[worktree-submodule-deinit-shared-config]]).
