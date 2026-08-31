---
name: edge-gesture-selection-after-touchstart-5939
description: Edge-strip swipe gestures must re-check for a text selection on every move, not just at touchstart; the autoscroll-speed twin is still unfixed.
metadata:
  type: project
---

**#5939 (MERGED #5958, merge commit `2b9962a2c`)** iOS: long-press to select text at the
left edge, then swipe down, drove the brightness slider instead of extending the selection.

**Root cause / the pattern.** Every capture-phase edge-strip gesture arms at `touchstart`
and activates later on a distance threshold. A `touchstart`-only selection guard is
therefore always wrong: the OS long-press creates the selection AFTER the finger is
already down, so the gesture is armed by the time the selection exists. The guard must be
re-evaluated in `onTouchMove` while `!activeRef.current`, and must yield **permanently**
(one-way) because iOS transiently collapses the selection while a handle is dragged.

**Two paths, both required:**
- non-collapsed `doc.getSelection()` -> native long-press select and handle drags;
- `renderer.scrollLocked` -> the instant-highlight quick action, which sets
  `userSelect: 'none'` and SYNTHESIZES its range (`useTextSelector.ts` `startInstantAnnotating`),
  so it never produces a DOM selection. A selection-only check misses it entirely.

**Prior art, same guard:** `BookmarkPullDown.tsx` `onTouchMove` (added by #5757) and
`useCapturedTurn.ts` `hasActiveSelection` in the `move` phase.

**STILL UNFIXED:** `useAutoScrollSpeedGesture.ts` (right-edge swipe to change auto-scroll
speed) has the identical `touchstart`-only guard and the identical defect. Deliberately
left out of #5958 to keep it scoped; flagged in that PR body for a follow-up.

Never device-verified on a physical iPhone; the repro is at the event-ordering level in
jsdom (`src/__tests__/hooks/useBrightnessGesture.test.tsx`).

Related: [[pull-down-bookmark-gesture-1359]], [[feedback-always-verify-on-xiaomi]]
