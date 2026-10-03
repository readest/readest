---
name: fixed-layout-missing-primaryindex-tts-6071
description: PDF TTS skips paragraphs, never highlights, and loops a page at a time because a fire-and-forget ResizeObserver re-render wipes the textLayer under the live TTS ranges - FIXED by a render-signature guard in pdf.js
metadata:
  type: project
---

Issue #6071 (filed 2026-09-05, reported by email, iOS). PDF Read Aloud skips most
paragraphs, never highlights, and when a page comes back fully empty it reads one
paragraph then turns the page — looping to the end of the book. EPUBs fine.
**Xiaomi-VERIFIED** (2211133C, Android 16, WebView 153, Readest 0.12.6) on the
reporter's own PDF.

**ROOT CAUSE — each PDF page renders TWICE per page turn:**

1. `pdf.js:462` — every PDF render does `container.replaceChildren()` on `.textLayer`.
2. `fixed-layout.js:217` — `#observer = new ResizeObserver(() => this.#render())`
   **discards** the `renderPromises` array. `#render()` returns it precisely so callers
   can await the async text-layer rebuild; `fixed-layout.js:808-809` does that correctly
   (`await Promise.all(renderPromises)`), the ResizeObserver does NOT.
3. Page turn: `forward` -> `#initTTSForSection` -> `onSectionChange` -> `renderer.goTo` ->
   `goToSpread` -> `#render` -> pdf render -> wipe #1 (awaited). `#initTTSForSection`
   (`TTSController.ts:709,754`) then builds `new TTS(doc,…)` over that DOM.
4. ~150ms later the ResizeObserver fires (the page turn changed layout) and re-renders
   the SAME page -> wipe #2 -> every Range the live TTS holds is detached.
   `getPDFSentenceBlocks` (`tts.js:156-213`) captured those text nodes up front.
5. Blocks now yield empty text -> empty SSML -> `TTSController.ts:1498-1520` skips them;
   a fully-empty page advances the section. `#nossmlCnt` resets at line 1522 on any
   non-empty block, so the 10-strike stop at line 1500 NEVER trips.

Dead ranges also explain the missing highlight — nothing left to anchor to.

**Why:** the destination (textLayer wiped under live TTS ranges) was guessable from code,
but the TRIGGER was not — I first blamed a `primaryIndex`/spread mismatch firing
`view.goTo` per sentence mark. That is a REAL but SEPARATE latent bug that does NOT fire
in `spread: none`. Only the device trace found the real trigger.

**How to apply:** to catch this class, patch `Element.prototype.replaceChildren` INSIDE the
PDF iframe realm (`f.contentWindow.Element.prototype`, per-frame, re-patch on a timer
since frames recycle) and log `new Error().stack`. A wipe whose stack has NO synchronous
caller is a ResizeObserver/floating-promise re-render. Correlate against a wrapped
`view.tts.next()` on one absolute clock — the ordering (NEW TTS, blocks, then a second
WIPE) is what proves it. Recipe in [[android-cdp-verification-recipe]].

**Latent, still unfixed:** `fixed-layout.js` implements NO `primaryIndex` (`grep -c` -> 0)
while `paginator.js:1689` does, and `types/view.ts:49` declares it **non-optional**, so TS
never flags the `undefined`. Both TTS consumers fall back to `contents[0]`
(`TTSController.ts:536-537`, `useTTSControl.ts:484`), and `getContents()`
(`fixed-layout.js:1723`) filters only `visibility:hidden` — so on a two-page spread
`contents[0]` is the wrong page and `useTTSControl.ts:492`/`:508` would fire
`view.goTo(cfi)` on EVERY sentence mark. Also: CBZ gets no TTS at all —
`comic-book.js:138` builds sections with no `createDocument`, `TTSController.ts:688` bails.

**FIX (2026-09-06, foliate-js `pdf.js`, submodule -> needs its own PR + re-pin):** guard
`render()` with a `renderedFor` WeakMap keyed by `{page, signature}` where signature =
`zoom|pageColors.background|pageColors.foreground|getFontScale(doc)`; early-return when it
matches. Set it right after the generation bump; a `forget()` helper clears it on the four
bail paths, but ONLY when `renderedFor.get(doc).generation === generation` so a superseding
render's entry is never clobbered. Fixing it in `pdf.js` (not the ResizeObserver) protects
against EVERY redundant render trigger, not just this one.

Test: `src/__tests__/foliate-pdf-redundant-render.test.ts` - asserts a node captured from
the first render is still `isConnected` after an identical second `onZoom`, plus two
guard-rails (zoom change and pageColors change DO rebuild). Needs a real IFRAME document:
`render` bails on `document.implementation.createHTMLDocument` because `defaultView` is null.

**VERIFIED 3 ways:** (1) unit test red->green; (2) browser A/B on the real bundle - unfixed
wiped every page TWICE with identical `had=2368`, fixed wipes once, and a node captured at
render time survived 4 page turns; (3) **Xiaomi with the reporter's own PDF after
`pnpm dev-android`** - 310 non-empty blocks, ZERO empty, clean 34->35 turn, word highlight
tracking down the page ("timber" -> "delivers"). The old build gave 4 blocks then empties.

Related: [[tts-fixes]], [[media-overlay-android-rewind-stall]], [[pdf-lock-horizontal-pan-5976]]
