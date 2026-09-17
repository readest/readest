---
name: proofread-selection-section-anchor-6148
description: "#6148 selection-scoped proofread rules never reapplied after a toggle/edit/reopen; root cause = the rule stored progress.sectionHref (a TOC href) but the transformer compares against foliate's spine item href (detail.name)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 030f1fcc-28d5-438f-881e-0270db02c7b8
  modified: 2026-09-08T16:22:22.988Z
---

2026-09-09. Issue #6148 (54wedge, carried over from the #6109 review). A
proofread rule with scope `selection` applied once and never again: any toggle,
edit, or reopen lost it.

**The rule always worked at creation for the wrong reason.** `ProofreadPopup`
does `range.deleteContents()` + `insertNode` on the LIVE document before saving
the rule, so what the user sees right after Apply is a direct DOM edit, not the
transformer. Every later render goes through `proofreadTransformer`, and that
path had never worked for selection scope.

**Root cause: two different section identities.**
- `ProofreadPopup` stored `sectionHref: progress?.sectionHref`, which is
  `tocItem.href` (foliate `TOCProgress.getProgress`) — the nearest *preceding*
  nav entry.
- `proofreadTransformer` compares it against `ctx.sectionHref`, which is
  foliate's `detail.name` from `Loader.createURL` — the **spine/manifest item
  href** (`sections[i].id === item.href`).

They coincide only when every spine item has its own TOC entry. Measured across
the repo's own epub fixtures: `sample-table-layout.epub` mismatches on 10 of 12
sections, `sample-alice.epub` on 2 of 16 (index 15 is `OPS/feedbooks.xml` whose
TOC entry is `OPS/main11.xml`), and the first spine item mismatches in most
books because covers have no TOC entry (`toc=undefined`).

**Fix — PR #6152, squash-MERGED 2026-09-09 as `1b681939d`** (content verified on
origin/main by grep, not by ancestry: GitHub squashes, so the branch tip is not
an ancestor). CI green on all 15 checks; branch deleted local + remote.

1. Match on the CFI the rule already carries. `TransformContext` gained
   `sectionCfi` (`bookDoc.sections.find(s => s.id === detail.name)?.cfi`, wired
   in `FoliateViewer`), and `inThisSection()` in
   `services/transformers/proofread.ts` compares the spine step (everything
   before the first `!`) of `rule.cfi` against it. This **heals rules already
   stored with a TOC href** — no migration needed. Formats without spine CFIs
   (markdown books via `utils/md.ts`, whose `section.id` is `String(index)`)
   fall back to the old href compare.
2. `ProofreadPopup` now stores the spine href
   (`getView(bookKey)?.book?.sections?.[selection.index]?.id`) so the field
   actually means what its name says.

**Dead ends worth not re-walking** (all were checked and are NOT the bug):
`text/html` vs XHTML parsing in the transformer (`transformContent` passes no
options so `docType` is always `'text/html'` — harmless), foliate's blob-URL
cache across `recreateViewer`, `cfi-inert` a11y skip-link injection (foliate's
CFI indexing filters those), `enabled`/`onlyForTTS` filtering, and
`viewSettings.proofreadRules` persistence.

**Verification recipe.** A vitest *browser* test is the only faithful
reproduction: load `sample-alice.epub` with `DocumentLoader`, create a real
`foliate-view` + `paginator.js`, attach `transformContent` to
`book.transformTarget`'s `data` event (capturing each `detail.name` → raw
string), `view.goTo(15)`, then pick the doc with
`getContents().find(c => c.index === INDEX)` — **not** `getContents()[0]`, which
is often the neighbouring section and silently yields a CFI for the wrong
document. Compute `view.getCFI(index, range)`, then re-run `transformContent`
on the captured raw string. jsdom reproduces everything except the
`sanitizer` transformer, which emits a duplicate `xmlns` there (a
DOMPurify/jsdom artifact — drop `sanitizer` from the list in jsdom).

**CodeRabbit review, 7 findings, all valid in substance, 3 resolved differently
than suggested** (commits `3b5b086d3`, `cc59920a5`):

- *Real bug it caught:* the live splice used the raw `replacementText` while the
  rule persisted `replacementText.trim()`, so whitespace around a replacement
  showed one thing this session and another on every replay — the very drift
  this PR removes. Trim once at the top of `handleApply`, reuse for both.
- *Four findings said the refusal toast described the wrong constraint.* True:
  the limit is one text node, and an `<em>` or link breaks that inside a single
  paragraph, so "select within a single paragraph" was followable-yet-refused
  advice. Did NOT take the suggested "single text node" — DOM vocabulary for
  someone reading a novel. Reworded the source key to "This selection spans
  formatting or paragraph boundaries. Select a smaller piece of text, or choose
  another replacement scope." and re-translated all 34 locales.
- *Two terminology findings (sv, bo), both verified against the files first:*
  `sv` has `Scope → Omfattning`, `bo` has `Paragraph → དོན་ཚན།` /
  `Chapter → ལེའུ།`, so `ཚིག་ལེའུ` conflated paragraph with chapter.
  **Rule worth keeping: a new translation must reuse the term already in that
  locale file** (`Scope`, `Paragraph`, ...) instead of coining one. Generalised
  to all 34, not just the two flagged. A follow-up round then caught the German
  coinage `Ersetzungs-Geltungsbereich`; took `Geltungsbereich für die Ersetzung`
  over the shorter `Ersetzungsbereich` because `Geltungsbereich` is what labels
  the scope picker the toast points at.

**Two related fixes landed in the same pass:**

- *Jump-to-selection affordance.* #6109 turned the `Selection` scope chip into
  the jump target, but it renders identically to the inert Regex / Case
  sensitive chips beside it, so nobody found it. The chip is a plain `RuleChip`
  again and the jump is its own `btn btn-ghost btn-sm h-8 w-8 p-0` next to
  edit/delete, using `MdOutlineArrowOutward` + the existing
  `_('Jump to Location')` string (already used by `FootnotePopup`, so no new
  key). The row reserves the cluster width with end padding, so the extra
  button needs `pe-36` instead of `pe-28` — measured, not guessed, in
  `src/__tests__/components/proofread-rule-row-clearance.browser.test.tsx`
  (`pe-28` + the third button demonstrably overlaps).
- *`deleteContents()` markup loss.* `ProofreadPopup` now splices the
  replacement inside the one text node instead of `deleteContents()` +
  `insertNode()`, which stripped markup the range touched and split the node in
  three (shifting the text-node indices every later CFI in the section counts
  on). A selection that spans elements is now refused with a toast, because
  `applyReplacementSingle` requires `startContainer === endContainer` and could
  never replay such a rule — it only ever "worked" via the live DOM edit.
  Note this made the shared `defaultProps.selection.range` in
  `ProofreadPopup.test.tsx` leak between tests (the fixture used to be a fake
  with `deleteContents: vi.fn()`); it is now rebuilt in `beforeEach`.

**Still open on this surface:** nothing from #6148.

Related: [[proofread-panel-design-pass-6109]], [[proofread-gate-reflowable-formats]].
