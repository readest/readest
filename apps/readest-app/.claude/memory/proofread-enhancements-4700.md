---
name: proofread-enhancements-4700
description: "Proofread/replacement-rule feature — sync, regex UI, Opt/Alt+P shortcut, i18n (issue"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41894f93-c46e-457b-be84-847ccf6243d7
---

Issue #4700 (FR: Proofread enhancements) — SHIPPED, merged to main via PR #4708. The proofread (校对/替换规则) find-replace feature lives in: data model `ProofreadRule` in `src/types/book.ts`; store `src/store/proofreadStore.ts`; engine `src/services/transformers/proofread.ts`; selection popup `src/app/reader/components/annotator/ProofreadPopup.tsx`; manager dialog `src/app/reader/components/ProofreadRules.tsx` (mounted in `Reader.tsx`); sidebar entry `BookMenu.tsx`.

What shipped (all test-first, full suite green):
1. **Sync** — added `'globalViewSettings.proofreadRules'` to `SETTINGS_WHITELIST` in `src/services/sync/adapters/settings.ts` (whole-field LWW). KEY INSIGHT: book- and selection-scope rules ALREADY sync because `src/utils/transform.ts` JSON-serializes the entire `viewSettings` into the synced book config (`configs`/`progress` category). Only library/global rules were stranded — they live in `settings.globalViewSettings.proofreadRules`.
2. **Regex** — the transformer ALREADY fully supported `isRegex`; only UI was missing. Added a Regex toggle to the selection popup AND a full "Add Rule" form (pattern/replacement/scope Book|Library/Regex/Case-sensitive) to the manager dialog, validated via `validateReplacementRulePattern`. Popup skips the whole-word validation when regex is on.
3. **i18n** — the whole-word warning in ProofreadPopup was a hardcoded English string (root cause of issue's point #2: Chinese user couldn't read it, thought symbols couldn't be replaced). Wrapped in `_()` + 8 new keys translated across all 33 locales via `pnpm i18n:extract`.
4. **Shortcut** — reused the existing `onProofreadSelection` (`ctrl+p`/`cmd+p`). `handleProofread` in `Annotator.tsx` now opens the rules manager (`setProofreadRulesVisibility(true)`) when there's no active selection, and opens the create-from-selection popup when there is. No new shortcut entry, no first-level toolbar button (maintainer said skip). NOTE: first attempt used a dedicated `opt+p`/`alt+p` action — reverted because macOS Option+P is a dead-key (emits `'π'`, not `'p'`; `useShortcuts` matches on `event.key`). Ctrl+P avoids that entirely. The Annotator selection shortcuts have no unit-test harness (same as onTranslate/onDictionary), so this wiring isn't unit-tested; `setProofreadRulesVisibility` itself is covered by ProofreadRules.test.tsx.

Later additions (same PR): modernized the manager dialog to the design-system primitives (SectionTitle, `card eink-bordered border-base-200`, `input input-bordered`, `btn-contrast` CTA disabled-until-pattern); scrollbar-to-edge via `contentClassName='!px-0'` on Dialog (the body's default `px-6 sm:px-[10%]` was insetting the inner scroll container); **drag-to-reorder** rules per category via @dnd-kit (mirrors `CustomDictionaries.tsx` — sensors, `dragModifiers`, `SortableContext`, drag-handle-only listeners). Reorder persistence = new `proofreadStore.reorderRules(envConfig, bookKey, orderedIds)` that rewrites only the `order` field (index-based) across BOTH stores (book config + global settings) in one call; the manager now sorts both displayed lists by `order` (stable, so default-1000 rules keep insertion order). NOTE: transformer re-buckets by scope (selection→book→library) so cross-scope drag order in the merged "Book Specific Rules" list is cosmetic — only within-scope order affects application; reordering a library rule there changes its GLOBAL order (affects all books).

Gotchas / caveats:
- **`wholeWord` field is a near no-op in the transformer**: `normalizePattern` always wraps ASCII patterns in `\b…\b` regardless of `rule.wholeWord`; `isValidMatch` never reads it. It only gates the popup's pre-create validation (`isWholeWord` on the literal selection). So ASCII substring replacement (e.g. "cat" inside "category") is impossible today — pre-existing, out of #4700 scope.
- **macOS Option+letter dead-key**: `useShortcuts` matches on `event.key`, so any `opt+<letter>` shortcut won't fire on macOS (Option+letter emits a special glyph, not the letter). Avoid `opt+<letter>` bindings; prefer ctrl/cmd. A robust fix would need code-based matching in `useShortcuts` (deferred).
- Test isolation: spying `useProofreadStore.getState().addRule` across multiple tests leaks call counts — add `vi.restoreAllMocks()` in afterEach.
- Run single test files with `npx dotenv -e .env -e .env.test.local -- vitest run <file>` (bare `npx vitest` crashes on supabase `atob`).
