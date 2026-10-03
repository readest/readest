---
name: cross-page-selection-edge-turn-5888
description: "PR #5888 (external, cross-page selection edge turn) review findings and the drag-latch/RTL fixes staged in the pr-5888 worktree"
metadata: 
  node_type: memory
  type: project
  originSessionId: 62a11ab8-b2aa-4666-a222-c91a7d808e08
  modified: 2026-08-26T18:40:24.788Z
---

PR #5888 by alexander-pecheny MERGED 2026-08-26 (squash `a91b503e5`); worktree and all local branches removed. It makes the #1354 corner-dwell auto page-turn actually reachable: `cornerAt` gains a `beyond` mode so a pointer that has LEFT the text rect reads as the edge it left by, plus a `PageTurnHint` bar and a "only an active drag arms it" gate. Author verified on a physical iPhone. CI green, `pnpm test` + `pnpm lint` clean on the PR head.

Review found 4 defects. Fix went in as `a0030286d` ("arm the edge turn only on a real drag, and mirror it in RTL"), a clean fast-forward `728d13e84..a0030286d` on `alexander-pecheny/readest fix/cross-page-selection-edge-turn`. RECIPE: `pnpm worktree:new 5888` REBASES, so its `pr-5888` branch is NOT a descendant of the PR head and pushing it would FORCE-push over the contributor ([[worktree-new-rebases-pr-force-push]]). Committed there, then `git checkout -b push-5888 <real head>` + cherry-pick, re-ran the gates on that base, pushed with the SSH URL (the `alexander-pecheny` remote is HTTPS and will not work) and `--no-verify`. `maintainerCanModify: true`. No PR comment posted.

1. **Long-press guard didn't hold** (reproduced): `pointerDragActive` was set by a pointermove *arriving*, and for touch/pen that is unconditionally true. A long press that drifts 1px marks its own selection as dragged, so a finger resting at the page edge flipped the page -- exactly what the code comment claimed to prevent. FIX: `noteDragTravel()` + `SELECTION_DRAG_SLOP_PX = 10`, origin from the first move of the gesture (not pointerdown, because a WebKit selection-handle drag streams moves with no matching down).
2. **`pointercancel` left the hint painted** (reproduced: `turnHint` stayed `{corner:'br',turned:false}`): the handler deliberately keeps the pending turn for Android, but no `touchcancel` listener exists and web fires pointercancel+touchcancel with NO pointerup/touchend, so `cancelAutoTurn()` never ran. FIX: gate the exemption on `appService?.isAndroidApp` -- only there does the native-touch bridge guarantee a later touchend.
3. **Stale latches across gestures** (CodeRabbit flagged the same, unaddressed): `selectionDragging` was reset only on pointerdown/touchstart. FIX: `beginSelectionDrag()` / `endSelectionDrag()` helper pair used at every gesture boundary.
4. **RTL/vertical-rl turned backwards**: the beyond rule mapped physical screen edges, but an RTL page ENDS bottom-left, so dragging forward off the left edge called `view.prev()`. Before the PR that region returned null (no turn), so the PR converted a missed turn into a wrong-direction one. FIX: mirror the horizontal axis in `cornerAt` when rtl; also extracted `edgeBeyond()` so `turnForFocusBeyondPage` (keyboard path) and the drag machine share one rule.

**PITFALL worth remembering independently:** `viewSettings.rtl` is NOT purely the book's writing direction. `FoliateViewer.tsx` ORs in `getDirFromUILanguage() === 'rtl'` ungated, so an Arabic/Hebrew UI marks an LTR English book rtl while foliate's own paginator `#rtl` (from `getDirection(doc)`) stays false. Used it anyway because `PageNavigationButtons` already maps screen sides through the same flag (physically-left button says "Next Page" when rtl), so the auto-turn now agrees with the rest of the reader. The UI-language term is a separate pre-existing bug in one shared flag.

Still OPEN / not fixed: the turn zone is now "everything outside the text box" including page margins (a finger parked in the margin for 500ms turns) -- a design call for chrox; `turnHint` state lives in `useAutoPageTurn` so every engage/turn/clear re-renders the ~2200-line Annotator; the diagonal (top-right reads as 'next'); `PageTurnHint.test.tsx` sets `data-eink` inside the test body instead of `afterEach`. CodeRabbit's inline at `useTextSelector.ts:951` is STALE (fixed by the PR's own commit 3).

Related: [[verify-reader-chrome-needs-e2e]], [[feedback-always-verify-on-xiaomi]]
