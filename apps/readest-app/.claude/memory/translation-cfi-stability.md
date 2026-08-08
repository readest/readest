---
name: translation-cfi-stability
description: The translation <font> wrapper buys nothing for CFI — no CFI code special-cases it; the real hazard is blanking source text nodes when the source is hidden
metadata: 
  node_type: memory
  type: project
  originSessionId: 23d24f5c-e4dc-482d-b692-69a990218a23
  modified: 2026-08-07T13:33:09.115Z
---

Belief to retire: that `createTranslationTargetNode` uses `<font>` **in order to keep highlight
CFIs stable across translation**. Measured against the real engine, that is not what is
happening.

Evidence (probe over `foliate-js/epubcfi.js`, jsdom + `DOMParser`, real `fromRange`/`toRange`):

- No CFI code path special-cases `font` — not `packages/foliate-js/epubcfi.js`, not
  `src/utils/xcfi.ts`, not `paginator.js`, not `overlayer.js`.
- A CFI generated for source text is **byte-identical** with the wrapper as `font`, `span` or
  `div`, with or without `cfi-inert`: `epubcfi(/4[b]/4[p2],/1:39,/1:45)` in every case.
- Cross-resolution is clean in all 16 combinations: a CFI made with translation off resolves to
  the same word with it on, and vice versa.

The reason is simply that the wrapper is **appended** (`el.appendChild(wrapper)`) after all
source text. Appending never shifts preceding text-node offsets or element indices. Any tag
would behave identically. So the tag is free to be chosen on *styling* grounds — and `<font>` is
the right choice there, because book CSS never targets it (see
[[paragraph-layout-has-allowlist-trap]]).

`cfi-inert` (honoured by epubcfi.js, paginator.js and overlayer.js; it drops a node **and its
subtree**, unlike `cfi-skip` which hoists children) is therefore **not required** on the
translation wrapper for the append case. It would only harden against a future change that
injects mid-element, or against selections dragged across translated text.

**The actual CFI hazard is elsewhere:** `updateSourceNodes()` in `useTextTranslation.ts` sets
`textNode.textContent = ''` on every source text node when `showTranslateSource` is false,
stashing the originals in an `original-text-nodes` attribute. With the source hidden there is no
source text left in the DOM, so a CFI pointing into it **cannot resolve at all** (probe:
`NO-SOURCE-TEXT` / `UNRESOLVED`). Highlights on original text break in translation-only mode.
This is pre-existing, unfixed, and unrelated to the wrapper. If it is ever fixed, the clean way
is to hide the source via a `cfi-skip` wrapper (children hoisted → CFI preserved) rather than
destroying the text.

Locked by `src/__tests__/utils/epubcfi-translation-stability.test.ts`.

## Decision 2026-08-07: translations are NEVER excluded from CFI

Chrox's call, asked and answered twice: do not exclude translation nodes from CFI **in any
form** — not via `cfi-inert`, and not via a narrower filter either. Users highlight translated
text, so it must stay CFI-addressable. Do not re-propose this.

The known cost, accepted: `paginator.js`'s visible-range TreeWalker (the one that derives reading
position) rejects only `cfi-inert`, so a **reading-progress** anchor can land inside a
translation. That produces, on a book with no native `<font>`:

```
Failed to apply remote progress
Failed to convert XPointer …/section[2]/div[1]/font/text().164
Error: Element index 0 out of bounds for tag font
```

Pre-existing (translations were always non-inert `<font>`s) and harmless locally — it only breaks
*remote* progress sync to a device that has no such translation, e.g. KOReader. A fix keyed on
`translation-element-mark` in that single TreeWalker was proposed and **declined**. If this
resurfaces as a bug report, it is this, and it is by design.

## Shipped structure (2026-08-07)

Three nested `<font>`s collapsed to one `<font class="translation-target translation-target-block">`
appended to the source element. CFI into translated text went from `/2/2/2` to `/2`, which
**invalidates any highlight previously saved inside translated text** — it degrades silently
(skip + keep record) rather than mis-anchoring. Hiding the original now wraps it in a
`cfi-skip` `<font>` instead of blanking text nodes, so source CFIs survive with the original
hidden; the `original-text-nodes` stash was deleted. #1582 markup preservation round-trips inline
HTML through the translator (Bing repositions tags semantically) with echo-validated sanitizing
and run-boundary chunking. See [[paragraph-layout-has-allowlist-trap]].
