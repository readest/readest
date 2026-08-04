---
name: i18n-label-rename-workflow
description: "Renaming a settings label renames its i18n key — derive the new translations from each locale's own old value, and mirror the rename in commandRegistry.ts"
metadata:
  node_type: memory
  type: feedback
---

Because this repo is key-as-content, **renaming a UI label renames the translation key** in all 33 locales. Copy-only PRs (#5287 dropping "Show" from the Header & Footer rows, #5301 "Column Gap" -> "Additional Margin") are therefore i18n PRs.

**Don't retranslate the new label from scratch.** Recover each locale's *old* value and strip the changed word from it — that keeps the result in the translator's own terminology instead of substituting yours:

```
git show <base>:apps/readest-app/public/locales/<code>/translation.json
```

For #5287 that turned `"Show Remaining Time": "Verbleibende Zeit anzeigen"` into `"Remaining Time": "Verbleibende Zeit"` mechanically, for every locale, with no guesswork. Check first whether the new key already exists (`Reading Progress` did) — the extractor reuses it and you get one fewer string to write.

**Also grep `src/services/commandRegistry.ts`.** It mirrors a subset of settings labels as `labelKey` for the settings-search palette; a rename that misses it silently desyncs the palette from the panel. Its `keywords` arrays are separate, so leaving `'show'` in them keeps the old search term working after the label loses it.

**Partial revert without diff churn:** `pnpm i18n:extract` only ever *appends* re-added keys, so restoring a key you'd renamed lands it at the bottom of the file and shows as a move in the diff. Instead rebuild each JSON by walking the base commit's key order, taking the current value for keys that survived and the base value for the ones you're restoring, then appending genuinely-new keys. Re-run `pnpm i18n:extract` afterwards and confirm it is a no-op — that proves the file is exactly what the scanner would produce.

Related: [[i18n-extract-prunes-keys]], [[feedback_en_plurals_manual]], [[settings-panel-screenshot-via-playwright]].
