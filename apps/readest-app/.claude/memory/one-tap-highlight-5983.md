---
name: one-tap-highlight-5983
description: "#5983 one-tap highlighting: strip shows on selection when highlight tool is on toolbar; PR #6031; CDP can't reach iframe pointer listeners"
metadata: 
  node_type: memory
  type: project
  originSessionId: 56b4e367-4a1f-4b48-9160-1a9f849e9cfe
  modified: 2026-09-02T17:21:47.998Z
---

**#5983 one-tap highlighting** — MERGED #6031 (squash 87bba1369; branch and worktree cleaned up). When text is selected, the annotation popup opens with the HighlightOptions style/color strip already visible whenever `highlight` is in the customizable toolbar. Unconditional by user decision, no setting.

- Predicate `shouldShowHighlightOptions(toolTypes, selection)` lives in `src/utils/annotationToolbar.ts`. Annotated selection → always true (pre-existing behavior); popup-window selection without a CFI (synthesized footnote text) → false, it can't anchor a highlight.
- No new creation logic needed: `handleHighlight(update=true)` already creates the annotation when none exists at the CFI, so a color tap on a fresh selection highlights directly.
- `Annotator.tsx` widens the popup to `annotPopupMaxWidth` when the strip shows; otherwise width = tool count × 44px as before.
- **Verification gotcha:** Chrome-extension CDP input produces the native selection but its pointer events never reach the per-section iframe listeners Annotator attaches (docLoadHandler adds `pointerup`/`selectionchange`). Foliate iframes sit in shadow DOM (pierce shadowRoot recursively to find them). Fix: dispatch synthetic `PointerEvent`s into the iframe doc via javascript_tool — popup appears instantly. See [[annotator-overlay-z-layers]], [[annotations-hub-scroll-to-new-note-5987-5957]].
- Local `pnpm test` once showed "5 errors" (runner-level, all 10685 tests passing); a clean re-run exited 0. Flaky local jsdom noise, not CI-relevant.

**CI e2e follow-up (1adbbb6cb):** the first push failed `build_web_app` — all 10 annotation e2e failures were one locator: `popupTool('Highlight')` in `e2e/pages/ReaderPage.ts` uses Playwright's default substring name match, and the now-always-visible strip's "Select highlight style" button also answers to 'Highlight' → strict mode violation. Fix = `exact: typeof name === 'string'` in `popupTool` (all e2e tool labels are exact aria-labels from AnnotationTools.tsx). Verified 24/24 with `pnpm build-web` + `CI=1 pnpm test:e2e:web`; dev-mode runs are untrustworthy (nextjs-portal overlay eats clicks — see [[web-e2e-local-devserver-cold-compile-flake]]).
