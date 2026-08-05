---
name: pull-down-bookmark-gesture-1359
description: "#1359 WeRead-style pull-down-to-bookmark gesture + ribbon moved top-right; bridge pattern for BookCell-level gesture UI fed by iframe capture listeners; verified on Xiaomi 13 via synthesizeScrollGesture"
metadata: 
  node_type: memory
  type: project
  originSessionId: b55ba860-974a-43d9-b467-69f0794b9b2d
  modified: 2026-08-04T14:36:44.739Z
---

#1359 pull-down bookmark gesture, implemented 2026-08-04, MERGED #5493. User-confirmed working on Xiaomi 13; worktree and branches cleaned up.

- **Transform luminance trap**: translating the BookCell slide wrapper makes it a stacking context, which ISOLATES the texture's `mix-blend-mode: multiply` (`.foliate-viewer::before`) from the `bg-base-100` backdrop outside it — page brightened +3.8% (margin median 0.863 -> 0.896) for the drag. Fix: the wrapper carries its own `bg-base-100` so the blend backdrop lives inside the transformed group. Diagnosed with a live CDP `classList.add('bg-base-100')` on the installed build, no rebuild.
- Pull while toolbars visible (`hoveredBookKey`) dismisses them (`setHoveredBookKey('')`) instead of engaging the bookmark (user requirement).
- Device-test gotcha: a center tap on this device gets claimed by the annotator (paragraph selection UI), so "show the bars" needed a tap in a paragraph GAP at center-x, computed from `renderer.getContents()` rects of ON-SCREEN docs only (first loaded doc can be a preloaded off-screen neighbor).

- UX copied from a WeRead recording measured frame-by-frame: page slides with the finger (1:1 to 120px, 0.35 damped past), slate `#6C717A` band above, hint rides the page edge then pins at safeTop+12, threshold 100px flips arrow (rotate-180 transition) + wording, preview ribbon `height = max(rest, offset)` whose fill ALWAYS previews the post-release state: `filled = bookmarked !== pastThreshold`. Release past threshold dispatches the existing `toggle-bookmark` event; 250ms cubic-out spring.
- Files: `utils/bookmarkPullGesture.ts` (pure math + per-book handler bridge), `components/BookmarkPullDown.tsx` (owns ALL ribbon rendering incl. resting `Ribbon`), BooksGrid BookCell slide-wrapper div around FoliateViewer+SectionInfo+HintInfo+ReadingRuler+ProgressBar, one `registerBookmarkPullDoc` line in FoliateViewer docLoadHandler.
- **Bridge pattern**: gesture UI lives in BookCell but touch listeners must attach per iframe doc in FoliateViewer's docLoadHandler (capture phase, after brightness/speed so their claims win). Module-level `Map<bookKey, handlers>`; docs delegate to whatever handlers the component installed. Avoids threading props through FoliateViewer.
- Gated by `canPullBookmark`: paginated reflowable horizontal-writing non-eink only. Downward-dominant activation (18px) with one-way yield to horizontal/upward — mirrors useBrightnessGesture; on consume call `setLayeredTurnTouchClaimed(bookKey,false)` + preventDefault touchend.
- Ribbon.tsx now `right-0 top-0` (was inset-0 = left), red style unchanged, dead `width` prop dropped.
- Preview ribbon SVG geometry (height/viewBox/points) is written imperatively per rAF; React only owns fill/stroke — React leaves unmanaged attrs alone on re-render. Notch depth frozen at 22% of REST height so it doesn't stretch into a spike.
- Xiaomi 13 verified green: `pnpm dev-android` install + scratch `*.android.test.ts` driving `Input.synthesizeScrollGesture {yDistance:+35%h, preventFling}` per [[android-cdp-e2e-lane]]; rAF recorder into `window.__pullLog` asserted band growth, fill flips both directions, ribbon toggle. Web smoke via throwaway Playwright spec + CDP dispatchTouchEvent (`test.use({hasTouch:true})`).
- [[turbopack-dev-stale-chunk-phantom]] bit AGAIN: dev-web started fresh in the new worktree still served chunks without the new module (probe logs empty); `rm -rf .next` + restart fixed.
- i18n: 4 hint keys translated across all 33 locales in one pass (script matched each locale's existing bookmark noun).
