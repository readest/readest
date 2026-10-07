---
name: custom-translation-providers
description: "Custom translation providers (OpenAI-compatible LLM + DeepL own key) and prompt library; PR #6582 MERGED (8076905ce); design choices chrox made"
metadata:
  node_type: memory
  type: project
  originSessionId: 80ca3f1a-5d6f-4f5c-b032-84116cb54b02
  modified: 2026-10-03T06:04:16.111Z
---

PR #6582 MERGED 2026-10-03 as 8076905ce. Work continues in a session on ANOTHER machine (chrox added: premium gating 50efbf7dc, translated-text styling 7d4bf3ea7); local worktree + branch REMOVED here 2026-10-03.
Researched mengxi-ream/read-frog first; spec (gitignored) at docs/superpowers/specs/2026-10-02-custom-translation-providers-design.md in the main checkout.

chrox's decisions: v1 = OpenAI-compatible + DeepL own key ONLY (DeepLX explicitly dropped, no generic HTTP template); providers sync with apiKey encrypted (OPDS pattern); prompt LIBRARY (not per-provider prompt), prompt chosen PER BOOK (`translationPromptId` in TranslatorConfig).

Shape: registry names `custom:<uuid>`; `TranslatorName` widened to string; `TranslationProvider` gained `concurrency`, `getCacheKey`, `requiresApp`, `context` arg; LLM batching lives inside the provider (`services/translators/custom/openaiCompatible.ts`); store `store/customTranslatorStore.ts`; replica kinds `custom_translator` + `translation_prompt` under ONE sync category `custom_translator` (alias in syncCategories.ts).

**Why:** future follow-ups (markup-preserving LLM, DeepLX, glossaries) should extend this, not re-litigate scope.
**How to apply:** never device-tested against a real LLM/DeepL at PR time; server allowlist needs a web deploy before sync works.
