---
name: wordlens-en-ar-zh-hant-6286
description: "#6286 Word Lens Arabic + Traditional Chinese — en-ar pack built from the kaikki dump (MSA only, artifacts filtered); zh-TW/HK/Hant hints = render-time OpenCC conversion of the Simplified en-zh pack; MERGED #6303 (bd15c03ba), CDN sync DONE"
metadata:
  type: project
---

**#6286 (2026-09-19): "FR: arabic support for word lens" + chrox: "en->zh-tw does not work".**
MERGED #6303 (bd15c03ba, 2026-09-19); worktree removed. CDN manifest lists en-ar (verified after merge).
Two commits: code (`e09dca4f2`) then `data(wordlens)` (`1868b937e`). CodeRabbit: no actionable
comments; all CI checks green. Soft warnings only: "out of scope" on the zh-TW half (chrox asked
for it in the same task) and docstring coverage 75% (repo uses `//` comments; ignored).

**Root causes.**
- Arabic: no `en-ar` pack in `data/wordlens/manifest.json` / CDN. The hint selector only lists
  targets the manifest offers for the book's source, so العربية was invisible. A "missing
  language" in Word Lens is ALWAYS a missing pack, never code.
- Traditional Chinese: `en-zh` is the only Chinese pack and its glosses are Simplified (ECDICT).
  `zh-TW`/`zh-HK`/`zh-Hant` resolve to it by base code (`baseCode()` in the panel,
  `split('-')[0]` in `wordlensSection.ts`), so 正體中文 readers got Simplified hints. The
  reader also passed `getLocale().split('-')[0]` as the Auto hint, losing the script.

**Fix: render-time OpenCC, no second pack.** `glossChineseVariant(hintTag)` in
`src/app/reader/utils/wordlensSection.ts`: last subtag `tw` -> `s2twp` (软件->軟體, 打印机->印表機,
激光->雷射, 信息->資訊), `hk`/`mo` -> `s2hk`, any `hant` subtag -> `s2t`, else null. Keyed on
subtags because Android/iOS report `zh-Hant-TW` (and `normalizeToShortLang('zh-Hant-TW')` in
`utils/lang.ts` wrongly returns zh-Hans — untouched). `initSimpleCC()` awaits BEFORE
`buildSectionTextModel` (re-check the `refreshGen` guard after it), conversion runs on the planned
occurrences AFTER `planGlosses` (cheap: <=2000 glosses, and `glossesShareMeaning` stays on the
Simplified data). `FoliateViewer.buildWordLensCtx` now passes the FULL locale as `appLang`.
Verified with the real WASM in a throwaway vitest file (a scratch `.mjs` cannot resolve
`@simplecc/simplecc_wasm` — it is a tsconfig alias, not a node_modules package).

**en-ar pack: 12,870 entries, 993 KB**, `build en ar .sources/en_50k.txt .sources/raw-wiktextract-data.jsonl.gz 20000`
(2.7 min per build from the cached Aug-25 dump; three builds this session). Coverage between
en-vi (9,759) and en-hu (13,641). Arabic is TARGET-ONLY like vi/hu: book text is unvocalized and
carries clitics (و/ال/ب) while Wiktionary headwords are vocalized, so `ar-en` needs a
morphological analyzer; asserted in `wordlens-pack-data.test.ts`.

**kaikki en->X build changes (`mergeEnToXEntry` + `dropOffScriptSenses` in
`scripts/build-wordlens-data.mjs`)** — all measured on the real dump:
- `roman` DROPPED (was appended as "word (roman)"): the hint is read by a native speaker and it
  doubled the ruby width. en-vi/en-hu have no roman, so their packs are byte-identical.
- Dialect translations SKIPPED: Wiktionary nests Arabic dialects under `code: ar` with a tag
  ending in `-Arabic` (Egyptian 682, Hijazi 503, Moroccan 402, S/N-Levantine 299/119, Gulf 181).
  Rule = tag endsWith `-${t.lang}`; bare `Arabic`/`Arabic-Indic` script tags do not match.
- Template artifacts FILTERED: a word mixing Latin letters into another script (`سِلْك m شُعَاع`,
  `فَرَنْسَا f or فَرَنْسَة`, `أَكَلَ imperfective: يَأْكُلُ`, `Hijazi Arabic وحش` — 54 glosses) and, once
  the pack is dominantly non-Latin, all-Latin editorial notes (`honesty` -> "not known in Arabic
  lands", `cicely` -> "probably no definite term"). Final pack: 0 glosses with Latin letters.
  Vietnamese/Hungarian are pure Latin so neither rule fires for them.

**Follow-ups.** (1) R2 sync DONE by chrox right after merge (clients still memoize the manifest
per session, see [[wordlens-en-hu-pack-5738]]). (2) `capForDisplay` in `gloss.ts` counts UTF-16 units, and
Arabic harakat are ~40% of them, so a 24-unit cap shows ~14 Arabic letters; 804 en-ar glosses
exceed it (they store the full hint; the cap is display-only). Counting `\p{M}`-free graphemes
would help; not changed. (3) Traditional-Chinese BOOKS (zh-TW -> en) still fail: `zh-en` headwords
are Simplified CEDICT and jieba is Simplified-centric; would need t2s on tokens. (4) Not
device-tested; Arabic `<rt>` RTL rendering in the reader unchecked.

Related: [[wordlens-feature]], [[wordlens-en-vi-pack-5737]], [[wordlens-sync-incremental-5737]].
