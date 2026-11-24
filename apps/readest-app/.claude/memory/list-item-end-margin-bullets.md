---
name: list-item-end-margin-bullets
description: Owner rule - normal mode renders book lists like calibre; Override Book Layout drops li end margin and shrinks the implicit ul/ol indent to 1.5em. MERGED #7338 UNRELEASED
metadata:
  type: project
---

Email + r/readest post 1xm70pr, 2026-11-05 ("Weird layout for bullet point lists"). The reporter's EPUB is archived at `~/Documents/books/issues/bullet-list-layout/`. No GitHub issue yet.

The book's `li { margin: 0 2em; padding: 0 1em 0 0 }` stacks on the UA 40px list padding at every level, so on a 353px column level-3 boxes are 90px wide and justified.

**Owner's call (2026-11-05):** "keep the rendering the same with calibre viewer". An earlier version cleared the end margin in normal mode and was withdrawn. Fix in PR #7338 (branch `fix/list-item-end-margin`): `margin-inline-end: unset !important` in the `li` rule of `getParagraphLayoutStyles`, under Override Book Layout only.

**Owner's follow-up (2026-11-05):** the implicit UA indent is too big; keep normal mode, make the default smaller under Override. Added `@layer list-indent { ul, ol { padding-inline-start: min(1.5em, 40px); } }` under Override only; the cap stops it growing past the UA default at large fonts (CodeRabbit). It beats the UA 40px and loses to every unlayered book rule. `:where()` was the first version and was wrong: the reader sheet loads after the book's, so it beat `* { padding: 0 }` (CodeRabbit on #7338). A book's own `@layer` list padding still loses; fixing that needs `$styleBefore` via the array form of `setStyles`, at all 8 call sites.

**Why li end only:** clearing the li start margin clips outside markers in the `ul { padding: 0 } li { margin-left: 2em }` pattern. The book's li `padding-right: 1em` is still kept.

**How to apply:** treat calibre as the reference for normal-mode book CSS fidelity. calibre's viewer.js injects only page margins, font size, colours and a user stylesheet. calibre and its viewer are blocked for computer use, so that comes from reading the installed viewer.js plus a book-CSS-only Chromium comparison, never from looking at the viewer. The reporter's Reddit screenshots were also never seen (reddit.com is blocked in Claude in Chrome), so normal mode still shows the squeeze the reporter may mean.

**Measured 2026-11-05 at the owner's screenshot (`ul` in `ol > li`, chapter2, 360x779, 20px):** normal mode leaves 45px of text over 18 lines, matching the screenshot's ~46px, so the screenshot is normal mode. Override on gives 145px over 5 lines (16px font: 85px to 181px). The fix does nothing for that screenshot until Override is on. Owner said "commit and pr" without choosing the options offered, so #7338 merged with normal mode unchanged and the li end padding kept; the li end padding under Override and a narrow-text safety net in normal mode stay open decisions. Tell the reporter to turn on Override Book Layout after release (Reddit is blocked in Chrome, so the owner posts it).

At a 40px font that item is still 5px wide with Override on: the book's li margins and padding (4em + 2em at depth 2) take the column, and an indent cap can't help. Unresolved, not in #7338.
