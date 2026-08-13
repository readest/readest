---
name: loaddocument-xhtml-parsererror-5625
description: "#5625 KOReader progress sync died because foliate loadDocument had no parsererror fallback; loadItem/loadReplaced always had one, so the render path was fine"
metadata: 
  node_type: memory
  type: project
  originSessionId: c108a474-3341-4a1b-ab6c-0c7c8fe02958
  modified: 2026-08-11T16:17:52.295Z
---

`#5625` "KOReader progress does not move the reader, then gets overwritten". Root cause was ONE
missing fallback in `packages/foliate-js/epub.js`.

`loadReplaced` (the RENDER path) has always retried a section as `text/html` when the XML parse
yields `parsererror`. `loadDocument` — which backs `Section.createDocument()`, the OFF-SCREEN
path — did not. `getCFIFromXPointer` in `src/utils/xcfi.ts` calls `createDocument()` whenever the
XPointer's section is not the rendered one, then reads `this.document.body.children`. Against a
`parsererror` document `body` is **null**, so it threw
`TypeError: Cannot read properties of null (reading 'children')`.

The throw escaped `applyRemoteProgress` (`useProgressSync.ts`) entirely — no try/catch — so the
reader never moved AND the proofread merge never ran; the 3s debounced auto-push then clobbered
the newer Kobo position. Fix = fallback in `loadDocument` + try/catch + drift anchor +
forward-only `goToFraction` fallback. **MERGED: foliate-js#70 as squash `63a2eb1`, then
readest#5630 as `474403e` (2026-08-11).** Device verify PENDING (the reporter reads on 2 Kobos +
iPhone).

**The reporter's "Defect 3" (render fallback does not run) is WRONG — do not chase it.** Probed
real Chromium and WebKit via playwright: `querySelector('parsererror')` DOES match (the error
block is `<parsererror>` in the XHTML namespace, inserted into `documentElement`), so
`loadReplaced` recovers. They looked for the literal console string `'Invalid XHTML'`, but the
code logs `doc.querySelector('parsererror')?.innerText ?? 'Invalid XHTML'` — the parsererror text
wins, so the string they grepped for never appears. Confirmed in the app: the repro book renders
clean, and `bookDoc.sections[13].createDocument()` returns 98 `<p>`s.

**Repro book:** `Harry Potter and the Philosopher's Stone.epub`, bookHash
`802f7eb4adb4d236935ff78ada5b205d`. EVERY one of its 32 spine files is malformed the same way
(unclosed `<meta charset="utf-8">` on line 3). Tell: `xmllint --noout` says
`Opening and ending tag mismatch: meta line 3 and head`.

Drift-anchor safety check for that book: KO fraction `176/411 = 0.4282` falls inside spine
section 13's size range `0.4111..0.4473`, so `resolveSpineSectionIndex` keeps the nominal index —
passing the anchor is a no-op here, not a re-anchor.

Related: [[translation-cfi-stability]], [[cfi-compare-null-crash-findnearestcfi]],
[[worktree-submodule-origin-is-local-gitdir]].
