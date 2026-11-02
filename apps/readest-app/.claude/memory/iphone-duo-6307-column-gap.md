---
name: iphone-duo-6307-column-gap
description: "iPhone Duo series #6312/#6507/#6508 all MERGED 2026-10-01; Column Gap is NOT Duo-gated (chrox reversed it); header/footer floor on text edge; web pixel-parity harness recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 2027a414-90ab-4db3-8c95-c799e279949d
  modified: 2026-10-01T09:21:58.562Z
---

iPhone Duo support (#6307, contributor kad-air) landed as three PRs, all MERGED 2026-10-01:
- #6312 side status-strip insets, every path gated on `isIPhoneDuo` (native flag from `iPhone19,4` / `SIMULATOR_MODEL_IDENTIFIER`).
- #6507 Column Gap (px) setting, cross-platform. chrox first asked to gate it to the Duo, then reversed:
  NOT gated. Follow-up commit d8e3393ee floors SectionInfo/HintInfo/ProgressBar inline padding at
  the text's outer edge (`getMarginalInlinePadding`, `getSpreadColumnGap` in utils/insets.ts),
  because foliate's `getColumnGapHostTracks` pulls the text edge in past ~2x the derived gap.
  Settings order: Column Gap AFTER Additional Margin (chrox).
- #6508 Xcode 27 status bar: `UIViewControllerBasedStatusBarAppearance` = true for ALL iOS
  (full-screen presented VCs now own the status bar). Real-device check on a non-Xcode-27 build
  was still pending at merge.

**How to apply:** non-Duo parity was proven with a headless Playwright pixel diff of two
`dev-web` servers (baseline worktree at the PR parent vs the PR): same seeded sample books,
6 viewports, reader/bars/panels/selection/footnote. Library cover ORDER varies run to run
(baseline-vs-baseline differs too), so treat library diffs as noise. Duo mode can be forced on
web with a temporary themeStore patch; only the native bridge ever calls `setIsIPhoneDuo`.
Related: [[worktree-new-rebases-pr-force-push]], [[worktree-rm-deinits-shared-git-config]].

**#7137 book mode MERGED 2026-10-30 (454ae3cbb), contributor wemcdonald + maintainer fixes.** Inner landscape is always two pages (no settings rows; chrox: "should be the default"); header button toggles one page. Gutter clears the hinge flat and partly open alike; toolbars never re-lay out the page (per-size status-bar records). NOT in the merge: hide the book-mode button in scrolled mode + hinge-doc wording (CodeRabbit on 60603c460) — patch at /Users/chrox/dev/readest-pr-7137-followup.patch, needs its own PR. Still open: first toolbar show per window size after launch re-spaces once; settings scrollbar "jumping" report not reproduced. Related: [[feedback-toolbars-never-change-layout]].

**#7146 orientation lock MERGED 2026-10-30 (716aadae2), wemcdonald.** On the inner display (resizable, `requestGeometryUpdate` refused) the reader lock now uses iOS 26 `prefersInterfaceOrientationLocked` (runtime override on `TaoUIViewController`). Duo sim verified: portrait and landscape hold, Auto releases. OPEN, not tied to the PR: after picking portrait on the cover display and then unfolding, the inner display stayed portrait and ignored rotation and Auto for about 3 min, with the PR lock off (lldb: `isInterfaceOrientationLocked NO`). It came free at a posture change. Never compared with main; the maintainer skipped that check. iPad untested.
