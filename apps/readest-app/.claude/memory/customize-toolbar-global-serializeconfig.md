---
name: customize-toolbar-global-serializeconfig
description: Customize Toolbar applied per-book not global; root cause = serializeConfig compared viewSettings by reference (!==) so array values were always stored as stale per-book overrides
metadata: 
  node_type: memory
  type: project
  originSessionId: c6601464-9463-4ac3-99c0-e7527e4051b5
---

Customize Toolbar (annotation bar, #4014, shipped v0.11.12) changes only applied
to the book where edited, not globally. Fixed in PR #4760 (MERGED, squashed onto
main as 7da5f8321).

**Root cause:** `serializeConfig` (`src/utils/serializer.ts`) decides which per-book
viewSettings to persist as overrides via `globalViewSettings[key] !== value` — a
*reference* compare. It deep-clones the config first (`JSON.parse(JSON.stringify)`),
so any **array/object** viewSettings value (`annotationToolbarItems`, and latently
`paragraphMode`, `proofreadRules`, `ttsHighlightOptions`, `noteExportConfig`) is a
fresh reference ≠ global → stored as a per-book override on **every** save (progress
autosave serializes with settings each relocate). On reopen the merge
`{ ...globalViewSettings, ...perBookOverrides }` lets the stale override shadow
global → a global toolbar change never reaches already-saved books.

**Fix (final — minimal, general, no special-casing):** compare viewSettings values
by content, not reference. Added `isSameViewSettingValue(a,b) = a===b ||
JSON.stringify(a)===JSON.stringify(b)`, used in the viewSettings reduce ONLY
(searchConfig left on `!==` — it holds functions / large `results`). The field
stays `annotationToolbarItems` in `AnnotatorConfig` (normal per-book viewSettings,
honors the isGlobal "Apply to This Book" toggle). PR diff is just serializer.ts +
serializer.test.ts.

**Iteration history (user steered):** (1) a `GLOBAL_ONLY_VIEW_SETTINGS` exception
forcing global save + strip/ignore per-book — rejected "don't make it an exception";
(2) move field to `SystemSettings.globalReadSettings` — rejected "too much";
(3) rename `annotationToolbarItems`→`annotationToolbar` for a clean slate — rejected,
keep the original name (it's synced in globalViewSettings). Landing point: keep the
name, fix only the serializer reference-compare bug.

**Known limitation (no rename clean-slate):** existing books may carry a per-book
`annotationToolbarItems` override from the buggy v0.11.12 build. The value compare
stops new ones and drops an existing one on next save when it matches global, but
does NOT retroactively clear an override whose content differs from current global —
those books keep the stale toolbar until re-saved while equal to global. A follow-up
one-time migration (clear persisted per-book toolbar overrides) would close this if
needed.

Tests: `src/__tests__/utils/serializer.test.ts` — array setting equal to global is
not persisted; differing array still persisted.
