---
name: crengine-xpointer-oracle
description: "Local crengine XPointer oracle (apps/readest.koplugin/scripts/xpointer-oracle.lua + src/__tests__/utils/xcfi.crengine-oracle.test.ts): dumps the real engine's XPointer for every word of an EPUB and checks xcfi.ts both ways; first run found and fixed three xcfi.ts semantics gaps (unindexed text().N was read cumulatively, single-spine /body/DocFragment/ rejected, offsets counted raw not whitespace-collapsed) — 2026-09-07"
metadata:
  type: project
  originSessionId: 85280a2e-03e0-46da-8144-1e680cc6af56
  modified: 2026-09-07T14:31:57.186Z
---

Built 2026-09-07 after #5271 (chrox: "for now only local validation, we may want to ship a cre bin
in the future"). No crengine is compiled or shipped: the KOReader emulator's `luajit` already links
the real engine, and the oracle script runs it headlessly through the spec harness
(`require("setupkoenv")` + `spec/front/unit/commonrequire`). Usage is in `docs/testing.md`.

**Oracle output** (`<book>.crengine.json`): per DocFragment, `{xp, xp_end, text}` for every
visible word (`getNextVisibleWordStart/End` + `getTextFromXPointers`), `every` N sampling, arrays
forced with luajson `InitArray` (empty Lua tables encode as `{}` otherwise). Committed fixture:
`src/__tests__/fixtures/crengine/sample-alice.json` (every=40, 707 words, 114 KB). Full alice at
every=1 (27,921 words) runs in ~95 s and passes 0/0 both ways after the fix.

**Harness rule**: the push check builds its CFI on the range the PULL check resolved (and only when
that range's text equals crengine's word). A sequential text search looked independent but with
sampling it found an earlier "the"/"of" and reported 313 phantom push mismatches. crengine writes
`/body/DocFragment/…` (no index) for a single-spine book; the harness normalizes it to `[1]`, which
crengine also resolves.

## crengine facts the oracle established (lvtinydom.cpp ldomXPointer::toString + a synthetic EPUB)

- `text()[K]` counts the parent's TEXT children only; `[K]` is omitted when there is exactly one.
  The offset is inside that node, NEVER cumulative over the element's descendants. `xcfi.ts` read
  unindexed `text().N` cumulatively, so `h2/text().1` after a `<span>Chapter 1</span>` landed on
  "hapt" instead of "Down" (58/27,921 alice words, all headings and `<li>`s).
- Whitespace-only text before the FIRST element child of a block is dropped
  (`<p>\n  <em>x</em>…` loses the leading node); whitespace between or after inline children
  survives as one space (`<em>a</em> <em>b</em>` keeps " " as `text()[1]`).
- Runs of whitespace inside a text node collapse to one space and offsets count the collapsed
  text (`lambda   mu` → "mu" at 7, raw DOM 9). Nothing is trimmed at block start.
- With one spine item the path is `/body/DocFragment/body/…`; `[1]` still resolves.
- Inside `pre`, `code`, `listing`, `plaintext`, `xmp`, `textarea` (fb2def.h built-in
  `white-space: pre`) whitespace is kept VERBATIM and offsets are raw; `code` counts even outside
  `<pre>`. Book CSS `white-space: pre` on other elements is NOT modelled (no computed styles
  off-screen) — a known residual.
- The leading-blank drop (lvtinydom.cpp:8958) applies only to BLOCK parents and not under pre;
  block-ness is CSS-driven in crengine, so xcfi uses a tag list (`BLOCK_TAGS`).
- A word at raw offset 0 of a text node that follows an element (`eta<br/>theta`,
  `<a id=.../>upsilon`) is `text()[2].0` in crengine.

**Fix shipped in `src/utils/xcfi.ts`** (same session, tests in
`xcfi.crengine-semantics.test.ts`): `crengineTextChildren()` (drop the leading blank node),
`toCollapsedOffset/toRawOffset` (whitespace runs), unindexed `text().N` → the sole text child,
`DocFragment(?:\[N\])?` in `extractSpineIndex` and `resolveXPointerPath`, and push builds the
pointer straight from the range's text node (`textNodeXPointer`) instead of a cumulative round
trip that snapped boundary offsets to the previous node. Full suite 11,018 passed; readera,
kosync and bookorbit consumers unchanged. Synthetic book (45 words incl. pre/code) 0/0 both ways.

**What it does NOT fix**: #5271 itself — see [[kosync-html-fallback-dom-mismatch-5271]]; on those
books the oracle still reports ~99% pull mismatches because the DOM shape differs (text/html
fallback), which is a foliate parser fix, not an xcfi one.

Related: [[koreader-emulator-headless-verify]], [[kosync-percentage-reanchor-impossible-path-5980]].
