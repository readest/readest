---
name: russian-hanging-prepositions-nbsp-4769
description: "Russian hanging-preposition NBSP transformer; generic per-language, lang-gated, no toggle"
metadata:
  node_type: memory
  type: project
  originSessionId: 423131fb-8192-4055-b617-3f79d412e258
---

Issue #4769: Russian typography forbids short function words (prepositions/conjunctions/particles) hanging at the end of a line ("hanging preposition"). Fix = a content transformer that inserts U+00A0 after such words so they stick to the next word. Source file is never modified.

**Where:** `src/services/transformers/nbsp.ts` (export `nbspTransformer`, name `'nbsp'`), registered in `transformers/index.ts`, added to the FoliateViewer pipeline AFTER `simplecc`, before `proofread` — must run after `whitespace` (which strips NBSP when `overrideLayout`) or the glue is undone. (Originally named `russianNbsp` / `russianNbspTransformer`; renamed generic so it's the home for NBSP across languages.)

**Generic by language:** internally a `NBSP_LANGUAGES: Record<langCode, {script, shortWords}>` registry; gate = `NBSP_LANGUAGES[normalizedLangCode(ctx.primaryLanguage)]` (so `ru-RU` -> `ru`; returns content unchanged if no entry). Only `ru` configured today; adding another language = one registry entry (its Unicode script name + a 3+ letter function-word list).

**Gating decision (user, via AskUserQuestion):** language gate ONLY, no settings toggle (deliberately skipped the issue's requested toggle to keep scope in `services/transformers`). Belarusian/Ukrainian/Bulgarian (also Cyrillic) are NOT included — `ru` only.

**Algorithm:** regex on the raw HTML string (NOT a DOM round-trip — avoids restructuring XML decl/doctype for every section, unlike `proofread`/`sanitizer` which parse+serialize). `TEXT_OR_SKIP = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>|>([^<]+)</gi` skips style/script blocks and only rewrites text between tags, leaving tags/attrs/entities byte-for-byte intact.
- Glue regex (built per language from `config.script` + `config.shortWords`): `(^|[^\p{L}])(<3+ letter words>|\p{Script=<script>}{1,2}) (?=[\p{Script=<script>}\p{N}])` -> replace `$1$2` + NBSP. 1-2 letter words of the script glue generically; 3+ letter function words need the explicit list (content nouns excluded so we never glue after them).
- No look-behind ([[feedback_no_lookbehind_regex]]): capture+re-emit the boundary char instead. Because the boundary is consumed, consecutive short words ("и в доме") need a loop-until-stable (`do/while result!==prev`); NBSP is in `[^\p{L}]` so a just-inserted NBSP counts as the next boundary.

**Known limitation (accepted):** postfix particles же/бы/ли glue FORWARD (to next word) not backward (to preceding word) — still prevents end-of-line hang, which is the issue's actual concern. Prepositions before digits glue too ("в 2025", "около 5").

**Authoring gotcha:** typing literal NBSP (U+00A0) into tool inputs near Cyrillic silently produced many stray NBSP bytes in source. Always write NBSP as the ` ` escape in JS source; normalize files with a Python `chr(0xA0)->chr(0x20)` pass then restore the one intended escape. Verify with `python3 -c "...read().count(chr(0xA0))"`, not shell `grep $' '` (matches regular spaces). Same applies to test assertions: define `const NBSP = ' '` and build expectations via template literals.
