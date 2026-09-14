---
name: annotation-popup-fixed-wrapper-offset-6036
description: "Selection toolbar rendered gridcell.left px off the selection because #6036's stacking wrapper was `fixed` while the popup's coordinates are book-cell relative"
metadata: 
  node_type: memory
  type: project
  originSessionId: 16805e26-947b-4944-9285-64245448959e
  modified: 2026-09-05T13:07:10.551Z
---

Regression introduced 2026-09-03 by commit 88ea2de55 (PR #6036, "keep the
annotation toolbar below the range handles"), unreleased as of 2026-09-05
(not in v0.12.6 — that is why web.readest.com was unaffected).

#6036 wrapped `AnnotationPopup` in `pointer-events-none fixed inset-0 z-[43]`
purely to make a stacking band below the range handles. `fixed` re-anchored the
popup's containing block to the viewport, but `Annotator` computes every popup
position in the **book cell's** coordinate space — `getPosition` /
`getPopupPosition` subtract `#gridcell-<bookKey>`'s rect, and that cell (`relative
h-full w-full overflow-hidden` in BooksGrid) was the popup's containing block
before. So the toolbar rendered exactly `gridcell.left` px to the left of the
selection whenever the cell left the viewport origin: sidebar open (240px), or
any book past the first in a split view. The commit's own comment asserted the
containing block "is still the viewport" — that was the wrong premise.

Fix MERGED 2026-09-05 as 65287bd3e (squash of PR #6068). `AnnotationPopup.tsx`: `fixed inset-0` -> `absolute inset-0`.
`absolute` + `z-[43]` still creates the stacking context #6036 needed, and
insets to the cell instead of the viewport.

**Rule: the two annotator layers do NOT share a coordinate space.**
- Popup surfaces (annotation toolbar, dictionary, translator, proofread) get
  **cell-relative** coords -> must be `absolute` inside the gridcell. Only
  AnnotationPopup ever got a wrapper; the other three are bare `<Popup>` and
  stayed correct, which is why only the toolbar looked wrong.
- Range-edit handles (`SelectionRangeEditor`, `AnnotationRangeEditor`) get
  **window** coords from `getHandlePositionsFromRange` (`frameRect.left + ...`),
  so their `fixed inset-0 z-[44]` layers are right as-is. Don't "fix" those.

Repro/verification recipe (CDP cannot open the popup on its own): the extension's
`left_click_drag` selects text but the iframe never sees a `pointerup`, so the
toolbar never opens. Get the iframe by walking shadow roots (foliate-view keeps
it in a shadow DOM — `document.querySelectorAll('iframe')` returns []), then
dispatch a synthetic `PointerEvent('pointerup', {bubbles, composed, pointerType:
'mouse', clientX/Y at the selection rect})` on the iframe document. Assert
`gridcell.left + parseFloat(popup.style.left) - popup.getBoundingClientRect().left
=== 0`. See [[feedback-always-verify-on-xiaomi]] for the device lane.

**The `absolute` swap also broke the #6036 e2e test** (`build_web_app` /
`e2e/tests/annotation.spec.ts` "draws the range-edit handles above the selection
toolbar"). It located each stacking band with `popup.closest('div.fixed')`, a
class-name stand-in, so `layers.toolbar` came back null. Fixed in b804081a6 by
walking up to the nearest ancestor with a non-`auto` z-index instead. Note the
handle element itself carries `z-50`, so the walk MUST start at `parentElement`
or it returns 50 rather than the 44 band.

E2E lane notes: run it with `pnpm test:e2e:web` (playwright reuses a dev server
already on :3000). Locally, 4 workers against `next dev` flakes hard ("adds a
note", "copies a link", "leaves the first line hittable", "deletes an
annotation", "opens an EPUB and turns pages" all failed on load and all pass
with `--workers=1`). CI is stable because it runs `pnpm start-web`, a production
build, with `retries: 2`. Do NOT chase those as real failures. `e2e/**` is also
outside tsconfig `include`, so `reader.page` protected-property errors from the
editor LSP are noise that `pnpm lint` never sees.

Regression test lives in
`src/__tests__/components/annotation-popup-layout.browser.test.tsx`
("AnnotationPopup anchoring") — jsdom cannot catch this (no layout), it has to be
a `.browser.test.tsx`. Related: [[annotator-overlay-z-layers]].
