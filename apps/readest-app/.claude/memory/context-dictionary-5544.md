---
name: context-dictionary-5544
description: "#5544 AI context dictionary: builtin:context provider reusing an OpenAI-compatible custom translator; MERGED via PR #5881 (dc554f2c3), UNRELEASED"
metadata:
  type: project
---

2026-10-03: chrox chose "on top of #5881 but purely our implementation": pushed (fast-forward, no force) to nphng15/readest `main` as revert-to-base commit + merge of main + our feature commit 6614e144d; PR #5881 retitled/re-described. CodeRabbit fixes in d66f4fa1f (selection context compared by value: mobile handle-shedding republishes the selection and restarted paid AI lookups; abort check before rendering a cache hit). MERGED 2026-10-04 as dc554f2c3; worktree + branches removed. chrox also said: no "AI" badge on the row.

Shape chrox asked for: no separate AI config; a `builtin:context` dictionary provider (default OFF, appended to providerOrder) that asks one of the user's OpenAI-compatible custom translators ([[custom-translation-providers]]), chosen via `dictionarySettings.contextTranslatorId` (synced, falls back to first). Row locked with a reason until such a translator exists + premium. Results render as a card in the dictionary window; explanation language = book `translateTargetLang`.

Key files: `services/dictionaries/contextDictionary.ts` (prompt, buildSelectionContext = own paragraph + neighbours capped 1000 chars/side, tolerant JSON parse, own AbortController per the tauriFetch trap), `providers/contextProvider.ts` (renders via i18n.t, failures shown inline not hidden), `DictionaryLookupContext.selection` (dropped for in-popup link navigation).

**Why:** #5881's separate API config + toolbar action + normal/detailed modes were rejected in favour of reusing translators + dictionary window.
**How to apply:** UNRELEASED; verified only with a mock OpenAI server in web dev (NEXT_PUBLIC_SELF_HOSTED=true bypasses premium); no real-model run yet (no gateway key in .env — only .example placeholders).
