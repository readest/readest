---
name: footnote-jump-flash-5647
description: "#5647 transient flash on in-page footnote jumps — searchHighlight.ts renamed to transientHighlight.ts; the three non-popup nav paths all live in FootnotePopup; resolveHref anchors return Element not Range"
metadata: 
  node_type: memory
  type: project
  originSessionId: 52f32dd3-e104-47f4-bc1f-abc82f0afece
  modified: 2026-08-12T16:39:20.893Z
---

Issue #5647: flash the target when a footnote link jumps in-page instead of opening
the popup (user directive: reuse the library-search transient highlight). MERGED
#5655 (dbe0dae0a, 2026-08-12); worktree and branches cleaned up. Chrome-verified twice on web (port 3001, synthetic drop
import): forward jump flashes the note block, backlink flashes the source paragraph,
clears after 4s, and an epub:type noteref still opens the popup with no flash (popup
path untouched). Demo GIF in ~/Downloads/footnote-jump-flash-5647.gif; fixtures in
session scratchpad. NOTE: inlining an epub as a base64 string literal into
javascript_tool corrupted the zip (zip.js "process error:-3") — serve the file from a
local CORS http server and fetch() it in the page instead.

**Non-popup footnote navigation has exactly three paths, all in `FootnotePopup.tsx`:**
1. `footnoteHandler.handle()` returns undefined (link not footnote-shaped) → foliate's
   own `#handleLinks` does the `goTo`. The app never calls goTo here, so hook AFTER
   checking `handle()`'s return value plus `event.defaultPrevented`.
2. `handle()` promise rejects (extraction failed / `check` too complex) → catch does
   `view.goTo(detail.href)`.
3. Same rejection inside the popup's own link listener (`handleBeforeRender`).

**Why:** the "footnote that jumps" case in the wild is precisely the one where
detection heuristics fail, so gating the flash on "is a footnote" would be circular.
Flash on any in-page link jump; section-only hrefs (no `#hash`) resolve anchor to `0`
and are skipped naturally.

**Trap:** `FoliateView.resolveNavigation`'s type says `anchor: (doc) => Range`, but
for hash hrefs epub.js returns the target **Element** (`getHTMLFragment`) and `() => 0`
without a hash. `transientHighlight.ts` duck-types with `'startContainer' in resolved`
(cross-realm safe, see [[iframe-cross-realm-instanceof]]). Empty inline markers
(`<a id="fn1"/>`) fall back to closest sentence container, then `parentElement` when
textContent is empty.

`searchHighlight.ts` → `transientHighlight.ts`, `showTransientSearchHighlight` →
`showTransientHighlight`, overlay key `library-search-highlight` → `transient-highlight`.
Older memories citing the old names are stale after this merges.
