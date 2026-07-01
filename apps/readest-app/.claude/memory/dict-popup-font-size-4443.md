---
name: dict-popup-font-size-4443
description: Adjustable dictionary popup font size via ::part() + em-rebasing; the only cross-shadow font hook for MDict
metadata: 
  node_type: memory
  type: project
  originSessionId: b105ba93-61b7-4d28-a269-1201a7be89bd
---

#4443 — adjustable dictionary popup font size (independent of the reading view).
SHIPPED: merged to main via PR #4734.

**The lever** = `DictionarySettings.fontScale` (number, default 1), set in
Settings → Language → Dictionaries (`SettingsSelect`, 85–175%). Stored in the
dictionary settings; SYNCED by adding `dictionarySettings.fontScale` to
`SETTINGS_WHITELIST` (whole-field LWW, like providerOrder). `setFontScale` in
`customDictionaryStore` + default-merge in `loadCustomDictionaries`
(`?? DEFAULT_DICTIONARY_SETTINGS.fontScale`).

**Plumbing**: `useDictionaryResults` returns `fontScale`; `DictionaryResultsBody`
puts `data-dict-content` + inline `--dict-font-scale` on each per-tab container
(the `setContainerRef` div). All CSS lives in `globals.css`.

**Two non-obvious CSS facts that drove the design:**
1. **MDict renders into a Shadow DOM** (`shadowHost.attachShadow`, the only
   provider that does) → its body is unreachable by ordinary popup CSS.
   `::part(dict-content)` is the ONLY hook. So `mdictProvider` sets
   `body.setAttribute('part','dict-content')` AND adds a stable host class
   `dict-shadow-host` (the `::part()` rule needs a host selector subject).
   `--dict-font-scale` inherits across the shadow boundary, so the outer rule
   `…::part(dict-content){font-size: calc(var(--dict-font-scale,1) * 0.875rem)}`
   resolves it. The dict's own shadow CSS never targets our wrapper `<div>`, so
   no cascade fight — em-based dict content scales from it, px-based stays fixed
   (expected for a font-size lever).
2. **Light-DOM providers size text with Tailwind `text-*` = root-relative `rem`**,
   which a container `font-size` can't move. Fix = re-base the utilities to `em`
   WITHIN `[data-dict-content]` only: `[data-dict-content] .text-sm{font-size:.875em}`
   etc. Higher specificity than the bare utility + declared after `@tailwind
   utilities` → wins, no `!important`. Container itself = `calc(scale * 1em)`.

**Verify**: the CSS contract (em-rebasing + `::part` + var inheritance) needs a
real browser — jsdom has no layout. Covered by
`dict-popup-font-size.browser.test.ts` (scale 1 → 18/14/14px, scale 1.5 →
27/21/21px, incl. the shadow body). Provider/store/whitelist sides have jsdom
unit tests. See [[css-style-fixes]].
