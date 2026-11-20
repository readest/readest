---
name: footnote-check-superscript-7537
description: "#7537 footnote popup jumped + showed whole chapter: foliate `check` rejected rich notes for <sup> refs, and a rejected view still opened the popup; MERGED #7541 431ea8cae, foliate #171 + #173 (pin 297e121)"
metadata:
  node_type: memory
  type: project
  originSessionId: 31fc7d74-ab4a-4e56-a859-d09377adcfdc
  modified: 2026-11-17T15:29:31.096Z
---

#7537 (filed 2026-11-14): clicking a footnote jumped the main view AND opened a popup with the whole chapter. Community PR #7541 (sx4im) was reworked by the maintainer session on 2026-11-17 (a77e23ef3).

- Two causes. (1) Readest sends `check` when `shouldCheckAsFootnote` matches the link text; foliate's `check` rejects a note body with >3 element children, even for `<sup>` refs that `maybe()` already recognises. (2) On rejection, readest's popup `load` listener had already started `trackPopupContentSize` (from #5887), so the popup opened on the unextracted whole section while `docLinkHandler`'s catch jumped the main view.
- Fixes: foliate readest/foliate-js#171 (`check: check && !maybe()` in `handle()`; MERGED 09e68ee84), cherry-picked to `fix/footnote-check-superscript-on-pin`, pinned at bf31c60 in #7541; `docLinkHandler` catch now calls `stopTrackingPopupContentSize()` + `setShowPopup(false)`.
- The reporter's EPUB as uploaded no longer reproduces on main: #7436 (2026-11-15) made `[2]` match the marker regex, so two `[2]` links trip the nav-list threshold and `<sup>1</sup>` gets no `check`. To reproduce, unlink one `[2]` in Section0001.html. Book copy: scratchpad only (not archived).
- Competing foliate PR #162 (yuxino) accepts a rich note for a text-detected ref when the note links back to it; complementary, touches different lines in footnotes.js.

**Why:** a bug masked by an unrelated heuristic change looks "fixed" on main; repro against the build the reporter filed on.
**How to apply:** when a footnote report doesn't reproduce, log `detail.check` in `docLinkHandler` on dev-web first. See [[opds-autodownload-dev-web-recipe]] for the dev-web Playwright pattern.
- Follow-ups on the PR (397402822): stale-rejection guard (`linkRequestRef`) in `docLinkHandler`; foliate `isSuper` now `parseFloat(verticalAlign) > 0` (0px was "super"). Declined: nested `<a><span><sup>` in `maybe()`, and stopping `getFootnoteRange` at headings (pre-existing; candidate foliate follow-up).
- Final (2026-11-17): #7541 MERGED as 431ea8cae, pinning foliate 297e121 on `fix/footnote-check-superscript-on-pin` (#171 + #173 cherry-picked, merged with main's `fix/vertical-preload-on-pin` 8e2ea0f). #173 = yuxino's #162 re-opened from readest/foliate-js because org-owned forks (febug) block maintainer pushes. `FootnotePopup` advances `linkRequestRef` on each link click and on data-attribute popups. Still open: #173 shows only the first paragraph of a multi-paragraph note that links back.
