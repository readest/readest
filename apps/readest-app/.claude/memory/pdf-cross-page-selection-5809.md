---
name: pdf-cross-page-selection-5809
description: "#5809 PDF selection across page iframes: per-page native selections composed into one TextSelection with `segments`; mouse drag freezes the origin page via html user-select:none (Chromium 148+); Android uses app handles in scroll mode"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3f16eafe-da59-471f-8f1e-2ce8978d22bd
  modified: 2026-08-23T05:37:33.890Z
---

Issue #5809 (FR: select text across PDF pages as one whole). Fixed-layout books
render every page in its own iframe, so a DOM Selection can't cross pages.
Implemented 2026-08-23 as PR #5831, MERGED `4df8b37b7` (issue closed;
worktree removed; main checkout `dev` left clean): a "composite" selection.

**Model:** `TextSelection.segments?: {range,index,text}[]` (reading order);
`range/index/cfi` = first segment, `text` = all parts joined with a space, so
copy/translate/dictionary/search/TTS/copy-link work unchanged. `getPosition`
gathers rects across all segments' frames. `handleHighlight` loops segments
(one BookNote per page; a note attaches to the first part, notebook saves the
combined text on it). Helpers in `src/app/reader/utils/crossDocSelection.ts`
(findContentAtPoint, toDocPoint, getDocTextBounds, buildCrossDocSegments,
applyCrossDocSegments, setNativeDragFrozen, isTextAtPoint).

**Desktop mouse (verified Chrome 151 web dev):** the browser keeps delivering
pointermove/up to the iframe the drag started in, with out-of-frame coords.
Blink resolves an out-of-frame drag point to the page START (position after
the `#canvas` div), inverting the selection. Freezing trick: `html
{user-select:none}` + `.textLayer {user-select:text}` on the origin page while
the pointer is over another page -> Chromium 148+ leaves the selection alone
(it never extends into user-select:none targets; same reason pdf.js dropped
its endOfContent-moving hack for Chromium 148+). The origin's part is set
programmatically (anchor -> page end), the target page gets start -> caret,
pages between are selected in full; `user-select` is restored on release.
Commit = `makeCrossDocSelection` in useTextSelector. `handlePointerDown` only
arms the drag anchor on real text (`isTextAtPoint`), never on blank margin
(a margin drag is a pan in fixed-layout scroll mode).

**Android (Xiaomi, WebView canary 153) -- VERIFIED 2026-08-23:** native
selection handles live in a PopupWindow -- their touches never reach
MainActivity's native-touch bridge nor the page, so a handle drag past the
page bottom can't be tracked; Blink jumps the extent to the page start
(whole-page inverted selection). Solution: fixed-layout + scroll (Webtoon)
mode -> at touchend the native handles are dropped (remove + 2 rAF + re-add,
the #1553 trick) and the app's SelectionRangeEditor handles take over
(`handlesSuppressed`); its drags call `dragSelectionTo(anchor, point,
commit)` which extends same-page or across pages; the committed composite
keeps `handlesSuppressed` so the handles stay. Device run: long-press
"obtaining" on page 40 -> 2 app handles; `adb input swipe` the end handle onto
page 41 -> A = anchor..page end (59 chars) + B = page start..finger, handles +
toolbar stay, Translate source text = joined text. `getCaretPositionInText`
clamps blank-margin points to the page text start/end (pdf.js abs-positioned
runs made caretPositionFromPoint snap to a run mid-page -> backward flash).
Paginated mode keeps native handles. iOS: not covered (WebKit native handles;
no hook). CDP `Input.dispatchTouchEvent` can't drag native handles (browser
side), use `adb shell input swipe` from the handle rect.

**Device pass on the PR APK (md5-matched, Xiaomi, 2026-08-23):** forward drag,
drag back onto the origin page, backward drag (start handle onto the previous
page), Highlight on a composite marks both pages and Delete removes both, pan
with a selection active does not extend, paginated (View Options "Single
Page") keeps native handles. Found+fixed in the PR (412a7103a): Highlight on a
composite toggled each part independently (flipped an already-highlighted
part off); now it adds the missing parts and only turns all off when every
part is highlighted. Note: "Webtoon Mode" off does NOT leave scrolled mode
(by design); use the "Single Page" zoom-mode button. Device residue: two test
PDFs opened via intent (`crosspage.pdf`, `crosspage2.pdf`), second one left
in Single Page mode.

**CodeRabbit follow-ups (89dee49aa, all marked addressed):** `dragSelectionTo`
commit with no new range must `releaseProgrammaticSelection()` (the guard
held during the drag otherwise swallowed every later selectionchange);
notebook placeholder tracking is now `notebookNewHighlightIds: string[]`
(Annotate creates one placeholder per page; cancel tears all down);
`handleHighlight` returns `BookNote[]`. Final APK 89dee49aa re-verified on
the Xiaomi (composite -> Highlight both -> Delete both). PR CI all green.

**Gating (82faf9570, user asked "perfectly gated in PDF scrolled mode"):**
`crossPageEnabled() = isFixedLayout && viewSettings.scrolled` guards the mouse
drag arming, the Android app-handle swap, `dragSelectionTo` (non-enabled =
old `rangeFromAnchorToPoint` single-doc path, no caret clamp, no cross-doc
writes) and the stale-selection clearing in makeSelection. EPUB/paginated
PDF: `handleHighlight` runs the one-part loop (same semantics), handles/
notebook unchanged; tests for EPUB + paginated PDF in
`useTextSelector-crossPage.test.ts`.

**Gotchas learned:** pdf.js link annotations show a yellow :hover box on
long-press (looked like an instant highlight); TOC lines are links -> long
press gives no selection. This device had Instant Highlight quick action on
(toggle via header Quick Action dropdown -> click the active item; toast
"Instant Highlight Disabled"). Chrome-MCP coordinate mapping on this Mac: to
hit a point seen at screenshot (sx,sy) pass (sx*1.112, sy*1.112) (window
zoom 90%: screenshot = CSS*0.957 but input coords are divided by 1.064).
`adb shell input swipe x y x y 900` = real long-press; CDP
`Input.synthesizeTapGesture {duration:800}` did NOT select here.
`getContents()` in paginated fixed layout includes a blank frame with
`index: undefined` -- always filter `index != null`.

**Verify/device recipe:** push a text PDF, MediaStore VIEW intent
(`content://media/external/file/<id>`), View Options -> Webtoon Mode,
`view.goTo(40)`; CDP driver at scratchpad `cdp.mjs` (node, WebSocket, adb
forward of `webview_devtools_remote_<pid>`).

**Open:** popup for a composite anchors by the existing start/end room rule
(may sit above the first part); iOS unsupported; EPUB scrolled cross-chapter
not enabled (gated on isFixedLayout); double-click-drag across pages keeps
the caret anchor (not word start).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5809 PDF cross-page selection](pdf-cross-page-selection-5809.md) MERGED #5831 (`4df8b37b7`), worktree removed, issue closed; gated `isFixedLayout && scrolled`; `segments` composite; mouse = html user-select:none freeze (Chromium 148+); Android = app handles in scroll mode (native handle touches never reach the page); Chrome + Xiaomi PR-APK VERIFIED (forward/back/backward/highlight/pan/paginated); iOS not covered
