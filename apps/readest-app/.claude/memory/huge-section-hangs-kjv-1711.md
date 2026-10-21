---
name: huge-section-hangs-kjv-1711
description: "Link-dense / single-file EPUB sections hang the reader; fixes MERGED #6678; foliate-js#126 MERGED 1a8bd29 (squash) 2026-10-09; readest#6680 MERGED b7f6ff8fd 2026-10-09 covers TTS/paragraph/footnotes, flat-document walks, one-level wrappers; WebKit-checked"
metadata:
  node_type: memory
  type: project
  originSessionId: 70e7020c-ae67-429e-b529-b986e53fda54
  modified: 2026-10-08T08:07:07.385Z
---

KJV study Bible EPUB (MOBI conversion; 2.2 MB Greek dict = section 113, 3.4 MB = 115, 20 MB concordance = 116 with 85,607 top-level body children) hung when following links. #1711 book (614 KB single file, zh) froze ~3 s on open. Investigated 2026-10-05..08.

Causes, each proven by measurement:
1. Link-target flash widened an empty marker to `<body>` (77 s). FIXED, #6678 MERGED (f74a19d39).
2. `a { position: relative }` + `a::before` hit-area rules made multicol layout crawl; opt-in via `html.link-hit-area` for <=1000 links. MERGED #6678.
3. Chromium pre-paint over multicol is O(siblings x columns); only smaller documents fix it -> chunking.
4. #1711 residual 1.1-1.2 s longest task = CJK @font-face mounting (2,771 subsets), not section size. Not shipped.

Chunking (readest#6680 rebased on main + foliate-js#126, both DRAFT, pushed 2026-10-08): sections >512 KB -> ~256 KB chunk docs with a hidden placeholder per other top-level element (CFI/XPointer identical). Chunk HTML built on demand; full doc NOT retained (skeleton + id map + WeakRef full reparse fallback); getContents lists primary chunk first; TTS reads into next chunk (TTSController #initTTSForAdjacentChunk); paragraph mode waits on doc change; footnote popup goes to anchor. Numbers: concordance jump 5.1-5.4 s, dictionary 1.15 s.

Placeholders expose quadratic walks in ANY flat doc (Blink range compare = O(child index); every DOM mutation updates all live Ranges of the doc): textWalker from common ancestor, Overlayer#splitRange, getBlocks Range per empty block, SSML marks inserted into section doc. All fixed in foliate#126. Still open: Readest loadContent (unzip+transform/sanitizer) on whole section = 3.0 s Chromium / 4.3 s WebKit on the 20 MB concordance, the bulk of the jump; CFI linear in top-level count; real devices unverified.

WebKit (Playwright webkit, 2026-10-09): chunk browser tests pass; KJV paging crosses chunks ~125 ms/turn; search + read-aloud chunk crossing OK; dictionary jump 1.37 s; concordance jump 7.7 s with one 5.5 s freeze (mostly loadContent). Harness: ENGINE=webkit uses scratchpad pw-profile-webkit (book already imported); vitest WebKit = copy vitest.browser.config.mts with instances [{browser:'webkit'}].

Wrappers (2026-10-09, foliate 4646642+fa0409e, readest fb4fdf772+1fd221b64): a top-level element > one chunk is cut between its children, ONE level only (user's call: "just handle one layer of wrapper as an edge case, and skip deeper wrappers"); deeper wrappers leave empty chunks, skipped via unit `linear` getter once split. Gotchas found by reading a wrapped copy of the #1711 book (scratchpad kjv/1711-wrapped.epub, id fedbee80...): Readest's scroll-wrapper around placeholder <table> = blank page; Readest skip links (cfi-inert) shift body child indices, so cross-doc paths must skip cfi-inert; paginator render() (ResizeObserver) used to clear #stabilizing mid-#display -> debounced container-scroll trimmed the jump target past a long view (dropped jump). One unreproduced sighting: flat 1711 once reported 0.667 right after the first chunk (possible chunk skip on cold load).

macOS app (debug build, 2026-10-09): links land in chunked dictionaries, boundary paging ok, Greek dict cold 1.6 s, concordance cold 7.5 s (5.8 s task) = Playwright WebKit. Pre-existing, NOT chunking: MOBI-converted books put link targets in an empty `<p><span id=filepos…></span></p>` before the heading; when WebKit lays that empty p at a column end, a link lands one page early (paginator scrolls to the marker's rect).

**How to apply:** for "book X hangs/slow" check section size, top-level child count, link count. Measure with the scratchpad Playwright harness pattern (trace-run.mjs cold jump with reload-to-section-0; kjv-chunks.mjs scenarios; FAKE_SPEECH init script = instant speechSynthesis to test read aloud headless since Edge TTS has no network there). A trace with 500k `FunctionCall` events on one line = a native->JS callback (TreeWalker filter) hot loop. Hidden Chrome tab = no rAF = paginator page turns hang until visible; don't misread as a bug. Cap waits at 1 min ([[feedback-bounded-waits]]).
