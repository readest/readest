---
name: column-gap-additional-margins-5301
description: "#5301 renamed layout label 'Column Gap (%)' to 'Additional Margin (%)'"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e294c30-13ba-4ed3-8d5a-74ea7c3d27b6
  modified: 2026-07-25T02:55:20.362Z
---

Issue #5301: the layout setting labeled **"Column Gap (%)"** was renamed to
**"Additional Margin (%)"** (branch `fix/rename-column-gap-to-additional-margins`,
Closes #5301).

**Why:** "Column Gap" names a CSS/pagination implementation detail that is
invisible to users — the paginated view is always at least one CSS column, so the
gap widens the left/right page margins. Users could not discover that raising the
gap is how you widen margins beyond the 144px cap. The gap is intentionally tied
to the left/right margin values to keep pages symmetrical (you cannot adjust the
gutter independently), so "gutter" is wrong too; it behaves as extra margin. See
also #3909.

**How to apply:** The string is an i18n key in two places — `src/components/settings/LayoutPanel.tsx`
(the `NumberInput` with `data-setting-id='settings.layout.pageGap'`) and
`src/services/commandRegistry.ts` (`labelKey`, keywords). Underlying setting is
still `viewSettings.gapPercent` / `settings.layout.pageGap` — only the visible
label changed. Renaming an `_()` key requires `pnpm i18n:extract` + translating the
new `__STRING_NOT_TRANSLATED__` across all `public/locales/*/translation.json`.
Watch for unrelated stray keys the extract surfaces (here: `Skeuomorphic Book
Covers` from #5245, dropped to keep the PR focused). Related: [[page-margin-live-update-4898]].
