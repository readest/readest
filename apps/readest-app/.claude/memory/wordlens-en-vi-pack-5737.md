---
name: wordlens-en-vi-pack-5737
description: en-vi Word Lens pack needs the 3.2 GB kaikki dump (no WikDict vi); kaikki throttles per connection so use aria2c -x16
metadata: 
  node_type: memory
  type: project
  originSessionId: e4c7a4f1-f9d0-4f42-85e8-baf26235aa7d
  modified: 2026-08-16T07:05:37.856Z
---

PR #5737 (2026-08-16) adds `en-vi` to Word Lens and makes `pnpm wordlens:sync` incremental.

**WikDict has NO Vietnamese** — `download.wikdict.com/dictionaries/sqlite/2/en-vi.sqlite3` is a
404, and the listing has only bg/ca/cs/da/de/el/es/fi/fr/ga/id/it/ja/ku/la/lt/mg/nl/no/pl/pt/ru/
sv/tr/zh. So `en-vi` uses the build script's kaikki `build` mode (not `build-wikdict`), reading
the Vietnamese `translations` off each English Wiktionary entry. No build-script change needed.

**kaikki throttles to ~270 KB/s per connection** but supports Range. A plain `curl` of the
3.2 GB English extract ETAs at 6 HOURS; `aria2c -x16 -s16` finishes in ~20 min. Always use
aria2c for kaikki. The dump caches at `data/wordlens/.sources/kaikki-en.jsonl` (gitignored).

**vi is target-only, by data not by code.** Vietnamese words are multi-syllable with spaces
INSIDE them ("hoc sinh"), so the planner's whitespace tokenizer would gloss syllables. Nothing
gates `vi` in `canTokenizeSource` — the pack just doesn't exist, which is how every unbuilt pair
behaves. Adding a `vi-en` pack without a segmenter first would ship visible garbage.

**Coverage is thin: 9,759 entries vs 14,769 (en-es) / 14,926 (en-de)**, with the hole in the
4k-14k rank band where most learnable-difficult words live. That is Wiktionary's en->vi
translation coverage, not the build. Measured follow-up: Vietnamese Wiktionary's English section
(kaikki `viwiktionary/Tiếng Anh`, only 114 MB, 118,902 glossed English headwords) would add
**14,814** more words from the top-50k frequency list, taking the pack to ~24k. Its glosses are
real bilingual-dictionary entries ("Dấu, đốm, vết."), not encyclopedic definitions, so quality
holds — but merging needs a new build mode plus cleanup for trailing periods and "Quá khứ ... của
X" (form-of) glosses. Many form-of entries would self-clear via `finalizeInflections` when the
lemma is present. Deferred, not rejected.

Packs are served from R2, not bundled, so `WORDLENS_R2_BUCKET=<bucket> pnpm wordlens:sync` must
run after merge or clients never see `en-vi`. See [[wordlens-sync-incremental-5737]].
