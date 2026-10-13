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
