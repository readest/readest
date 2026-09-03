---
name: kosync-percentage-reanchor-impossible-path-5980
description: "#5980 KOSync opened Ch6 for a valid Ch5 XPointer; the #5111 percentage drift anchor was built on a hypothesis its own issue disproved, and was removed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ef0a14a-f147-49be-acb2-456d41418d2c
  modified: 2026-09-01T14:17:55.353Z
---

Issue #5980 (albertmichaelj, 2026-08-30, Readest 0.12.6 iOS + KOReader on Kindle + Grimmory
KOSync server). Remote record `progress=/body/DocFragment[14]/body/div/h3[17]/text().0`,
`percentage=0.3113`. `DocFragment[14]` -> 0-based spine index 13 = Chapter 5, and the server's
own diagnostic CFI `epubcfi(/6/28!...)` agrees. Readest opened Chapter 6 instead. Reproduces
in **Receive Only**, so not a sync conflict / server overwrite.

**Root cause.** `resolveSpineSectionIndex` (`src/utils/xcfi.ts`) treats "percentage falls
outside the nominal section's byte-size fraction range" as proof of CREngine<->foliate
DocFragment drift and re-anchors by percentage. On this book (*Nexus*, Harari) the ranges are
Ch5 18.419%-27.803%, Part II divider 27.803%-27.840%, Ch6 27.840%-32.642%. Notes+Index are
~44% of all spine XHTML bytes, so CREngine's pagination percentage (31.13%) sits a whole
chapter away from where foliate's byte-size table puts it. Re-anchor 13 -> 15, then
`resolveXPointerPath` throws `Element index 16 out of bounds for tag h3` (Ch6 has 6 `<h3>`,
Ch5 has 17). `useKOSync.ts:188` catches, `navigated` stays false, and it falls through to
`view.goToFraction(0.3113)` -> Chapter 6. That fallthrough is why the user sees a *position*
rather than an error.

**Provenance — the anchor was never justified.** `resolveSpineSectionIndex`,
`buildSectionFractionTable`, `sectionIndexForFraction` and the `percentage` argument all
arrived in ONE commit, a435d8550 (PR #5111, adagues, merged 2026-07-15, first shipped
v0.11.20 on 2026-07-20). `git log -S` on each symbol returns only that commit. So #5980 is a
regression: before it, `getCFIFromXPointer` did `const xSpineIndex = XCFI.extractSpineIndex(xpointer)`
and nothing else.

The anchor was sub-commit 1 of 4, a speculative fix for a "Bug A" DocFragment<->spine drift
hypothesis. By sub-commit 3 the author had found #4444's real cause and said so in the issue
himself: a `parseXPointer` gap (the `tag[idx].N` format) made resolution fail, and the failure
fell back to the raw percentage, which moved the reader. Not drift. He then added
`isReportedByKOReader` in the same PR to switch his own anchor OFF for Kavita — the only
server the bug was ever reported on — leaving it on only for real KOReader, which it had
never been tested against. Supporting details that don't hold up: the "real reports show
DocFragment[326] landing on foliate section 274" in the comment appears in NO issue in the
repo; the old regression test could not detect drift (every stub section was `<p>Section i</p>`,
so `/body/p` resolved in all 54); and the comment cited "#5109", which is an Android
gallery-image PR. The anchor later spread to `useProgressSync` (koplugin path) via #5630 and
#5866 as if it were established mechanism.

**Fix — the anchor was REMOVED, not patched** (chrox's call, 2026-09-01). `getCFIFromXPointer`
is now a functional revert to pre-#5111: the section is the XPointer's own `DocFragment[N] - 1`,
full stop. Deleted `resolveSpineSectionIndex`, `buildSectionFractionTable`,
`sectionIndexForFraction`, `SpineSectionInfo`, `isReportedByKOReader` (it existed only to gate
the anchor) and the percentage threading at all 3 call sites (`kosyncProgress`, `useKOSync`,
`useProgressSync`). KEPT from #5111: the `parseXPointer` `tag[idx].N` support and the
`RemoteFractionResolution` discriminated union (#5065) — both real fixes. In `useProgressSync`
the koplugin's [page,total] fraction survives ONLY as the last-resort `goToFraction` target
when conversion fails.

**Why a fallback patch was not enough.** The first attempt kept the anchor and fell back to the
nominal section when the XPointer's path was structurally impossible there. Measured on the real
EPUB, that rescues only the lucky subset: `h3[17]` exists only in Ch5, so it worked — but
`/body/DocFragment[14]/body/div/p[50]/text().0` at the same 31.13% still resolved to
`epubcfi(/6/32!...)` = Chapter 6, silently and with a valid-looking CFI, because Ch5 has 215
`<p>` and Ch6 has 105. Paragraph locators are what KOReader emits nearly always, so the patch
would have left the common case broken.

**Why NOT "trust the nominal section first, re-anchor only on failure"** (the reporter's
preferred phrasing): it regresses #5111's own reference case, where `/body/p` resolves in every
chapter. Structural impossibility cannot discriminate drift from percentage disagreement —
which is the argument for removing the anchor rather than making it smarter.

Regression test: `src/__tests__/utils/xcfi.kosync-nominal-docfragment.test.ts` — the 29 REAL
spine sizes (uncompressed zip entry sizes = foliate's `section.size`) with synthetic chapter
bodies, since the EPUB itself is copyrighted. Pins BOTH the heading case and the paragraph case
to Chapter 5, plus a positionally-passed 5th argument being ignored.
DELETED `xcfi.kosync-section-offset.test.ts` (it asserted the removed behavior).

The fix is in `getCFIFromXPointer`, so it also covers note sync ([[koreader-highlight-deletion-dedupe-5818]]),
BookOrbit note sync, and `useProgressSync`. Related: [[loaddocument-xhtml-parsererror-5625]]
(#5630, the malformed-XHTML case, which is NOT this), [[sync-fixes]].

**Verified against the real EPUB** (`~/Documents/books/issues/5980/`, md5
607504f3480755ae37f9434bc1af0371). Measured boundaries match the report to 4 decimals
(Ch5 18.4189-27.8028, divider 27.8028-27.8397, Ch6 27.8397-32.6423); the re-anchor fires
13 -> 15; real Ch5 has 18 `<h3>` with `h3[17]` = "Nobody's Perfect", real Ch6 has 6;
pre-fix conversion in section 15 throws `Element index 16 out of bounds for tag h3`; post-fix
`getCFIFromXPointer` returns `epubcfi(/6/28!/4/2/410/1:0)`, which resolves to that `<h3>`.
The sync server's own diagnostic CFI was `epubcfi(/6/28!/4/2/410:0)` — identical element path.

Post-removal re-verification on the real EPUB: BOTH locators resolve into section 13 —
`h3[17]` -> `epubcfi(/6/28!/4/2/410/1:0)` = "Nobody's Perfect", and `p[50]` ->
`epubcfi(/6/28!/4/2/114/1:0)` = "Strongmen who claim to represent the people...".
Full suite 10620 passed, lint + format clean.

## crengine guarantees the 1:1 mapping (the answer to "can we re-implement #5111?")

No — there is nothing to re-implement. `crengine/src/epubfmt.cpp` ("Create a DocFragment for
each and all items in the EPUB's <spine>", ~line 1846) walks the spine ONCE and emits exactly
one DocFragment per item: an SVG spine item becomes a `SpineSvgWrapper`, an unparseable item
becomes a `SpineItemUnsupported` dummy. Its own comment gives the reason: "we won't be
inserting a new DocFragment between existing ones and get all xpointers (highlights, last
page) invalid because their DocFragment index has been shifted." So `DocFragment[N]` ==
foliate section `N - 1` BY DESIGN, and the calculated index is the identity — which is what
the code now does.

ONE documented exception, still exactly computable, NOT implemented (no reports):
`relaxed_spine = false` when `getDOMVersionRequested() < 20240114`, where only spine items
with media-type `application/xhtml+xml` get a fragment (`is_xhtml`, epubfmt.cpp:1731) — so the
mapping becomes "index into the XHTML-only subsequence". Needs `mediaType` on `SectionItem`,
which foliate does NOT expose (`epub.js:1228` copies size/cfi/linear but not mediaType), so it
would cost a submodule change + re-pin. KOReader pins the OLDEST DOM version only for books it
has seen before and then prompts to migrate (`readerrolling.lua:168-196`), so the window is
transient.

Local KOReader checkout for this kind of question: `~/dev/koreader`, crengine at
`base/thirdparty/kpvcrlib/crengine/crengine/src/`.

## chrox's rule, applied (2026-09-01)

"The SpineIndex should always be calculated and never be estimated, which is always wrong, and
we prefer not syncing other than wrong syncing." Consequence beyond the anchor: the percentage
FALLBACKS that moved the reader after a failed conversion are gone too.
- `useKOSync.applyRemoteProgress`: an XPointer that won't convert now reports `_('Sync failed')`
  and stays put. Percentage still drives non-XPointer servers (Kavita) — it is their only signal.
- `useProgressSync`: dropped #5630's `goToFraction(remoteFraction)` recovery for the koplugin
  path (CREngine `[page, total]`). #5625's real damage was the auto-push overwriting the newer
  remote position; that is prevented by the pull CONTINUING (config + proofread merge still
  run, test `a failed XPointer conversion still lets the rest of the pull run`), never by
  moving the reader.
`_('Sync failed')` needed no i18n work — already a key with translations in every locale.

## Shipped

MERGED as c81bd0bee (PR #6014, 2026-09-01), issue #5980 CLOSED. Squashed from 51e9f22ca (the
removal) + cca243b11 (review fix). Worktree removed. NO device verification: everything is
unit tests plus offline resolution against the reporter's real EPUB, and the reporter was
never asked to confirm on a build. The `silent` path now lands on syncState 'error' where it
used to land on 'synced', and that transition has only ever run in jsdom.
Also posted a write-up on PR #5111 (issuecomment-5497301323) explaining the revert.

CodeRabbit caught a REAL regression in 51e9f22ca (r3906132538), confirmed and fixed:
`pullProgress` took `receive || (silent && remoteIsNewer)`, called `applyRemoteProgress`
WITHOUT awaiting it, then set `syncState='synced'` unconditionally. The auto-push effect runs
on `syncState==='synced'` for every strategy except `receive`, so `silent` released the
debounced PUT of the STALE LOCAL position over the newer remote XPointer -- the exact #5065
damage. `resolveWithRemote` had the identical bug. Fix: `applyRemoteProgress` returns
`Promise<boolean>`; both callers `setSyncState(applied ? 'synced' : 'error')`.
The hole PREDATED the removal (old code also returned early when `getRemoteFraction` was
undefined); dropping the percentage fallback promoted it from rare to common.

RULE: #5065's regression test drives the `prompt` strategy, which builds a conflict and lands
on `setSyncState(hasConflict ? ...)`. The `silent` branch is a DIFFERENT code path and was
untested. Any change to KOSync apply/pull needs BOTH strategies covered, plus a positive
control so the gate cannot pass by disabling push everywhere.

## Direction test (use this on any future "DocFragment drift" claim)

foliate builds one section per `<itemref>`, unfiltered (`epub.js:789` `this.spine = $$itemref`,
`:1209` maps 1:1, `.filter(s => s)` drops only broken idrefs). CREngine emits at MOST one
fragment per spine item — `ldomDocumentFragmentWriter::OnTagOpen` opens a DocFragment only when
`!insideTag && baseTag==tagname`, so a second `<body>` in one file nests instead of starting a
new fragment. Therefore the CREngine fragment index is ALWAYS <= the foliate spine index: real
drift can only put the true section at or AFTER the nominal one, never before.
#5111's two claims both run backward (`DocFragment[16]`->14, `DocFragment[326]`->274), so
neither is reachable by any CREngine rule. Also note its reference fixture was circular: the
only evidence the fragment "should be" chapter 9 was the percentage, which is the signal in
question, so the test asserted the heuristic agrees with itself.
