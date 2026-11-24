---
name: settings-select-native-same-look-7658
description: "SettingsSelect (#7650/#7658): owner keeps the native <select> and main's exact look; chevron made clickable via padding overlap; prove 'looks unchanged' with Playwright pixel snapshots against main"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b5697729-be9d-4790-959b-cdbcff7a3d8e
  modified: 2026-11-19T16:20:19.583Z
---

#7658 (merged fd2603798, 2026-11-19) made the settings select's chevron clickable. A contributor had replaced the native `<select>` with a ~240-line custom listbox. On the owner's choices it was reworked twice:

- **"Rework to native"**: the custom menu dropped arrow keys/type-ahead and the iOS/Android/macOS OS pickers. The native select already toggles on a second press; the only bug was the chevron sitting outside the select's hit area.
- **"keep all appearence the same as it is in the main branch"**: no raised fill, no hover lift, no `eink-bordered` on settings selects. The chevron is made clickable by overlap only: select `pe-1!`→`pe-6!`, icon `-ms-5` + `pointer-events-none`. Same pixels as before.

**Why:** the owner treats the settings-row look as a product decision. An issue's "direction looks good" approved the goal (clickable chevron), not the restyle or the custom popup.

**How to apply:** for a UI fix in a shared primitive, change behavior only and keep the look byte-identical unless asked otherwise. Prove it with a throwaway Playwright spec on dev-web: `toMatchSnapshot(..., { maxDiffPixels: 0 })`, `--update-snapshots` with main's component swapped in, re-run on main for stability, then compare the change. Cover light/dark/e-ink/RTL, hover, open picker, desktop + 390px.

Gotcha found: `Dialog.tsx` adds a native `keydown` listener on its `<dialog>`, so a child's React `onKeyDown` `stopPropagation` is too late. Escape in an open base-select picker closed all of Settings. The fix is a native listener on the select while `:open` (wrapped in try/catch; WebKit throws on `:open`).

Related: [[settings-panel-screenshot-via-playwright]], [[feedback-pr-review-no-posting-offer]].
