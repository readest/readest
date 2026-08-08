---
name: proofread-gate-reflowable-formats
description: "Proofread toolbar button was EPUB-only; now gated on FIXED_LAYOUT_FORMATS. Selection-scope rules die on reopen when created where the position has no TOC item"
metadata:
  node_type: memory
  type: project
---

The selection-toolbar Proofread button was `disabled: bookData.book?.format !== 'EPUB'`
(from the original feature commit `54fdf5f1f`, #2725 "text replacement feature for EPUB
books"), so it was dead for MD, MOBI, AZW3, FB2 and FBZ. TXT escaped only because import
converts it to EPUB. Fixed 2026-08-07 with `supportsProofread(format)` in
`src/utils/annotationToolbar.ts` = `!FIXED_LAYOUT_FORMATS.has(format)` — PDF/CBZ render
pages, everything else runs the content transformers.

The gate was stale, not protective: `utils/md.ts` deliberately wires MD sections through the
same `transformTarget` pipeline (its comment names proofread), the book-menu Proofread entry
(`BookMenu.tsx`) was never format-gated, and the ctrl/cmd+P shortcut isn't either — so two of
the three entry points already worked for MD.

**Chrome-verified on "Markdown Smoke Test" (MD)**: rules apply live, book-scope rules survive
a full reopen, selection-scope rules survive too — *provided* the rule carries a `sectionHref`.

**The trap** (not MD-specific, but MD is most exposed): `ProofreadPopup` saves
`sectionHref: progress?.sectionHref`, which is `tocItem?.href` from the foliate relocate
event, so it is **undefined whenever the reading position has no TOC entry**. The transformer
then skips the rule forever — `proofread.ts` does
`if (ctxBase !== ruleBase) continue`, and `ctx.sectionHref` is always defined (MD: the section
index as a string; EPUB: the section name), so undefined never matches. The rule persists in
config.json and shows in the rules manager, but silently never fires again after any viewer
recreation. MD hits this constantly because Markdown text before the first heading (page 1 of
every file) has no TOC entry. Same rule created one spread later stored
`sectionHref: "1#section-11"` and survived. Diagnostic: the TOC sidebar's "Current position"
marker is driven by the same `progress.sectionHref` — no marker means a selection rule made
there will be born dead. UNFIXED; a fallback to the relocate section name would close it.

See [[hint-band-align-and-battery-invert-contrast]] for the Chrome verify session this came
out of, and [[browser-verify-readest-web-recipe]] for driving the reader.
