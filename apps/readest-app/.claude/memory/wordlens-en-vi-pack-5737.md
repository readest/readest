---
name: wordlens-en-vi-pack-5737
description: en-vi pack (no WikDict vi) is built from the kaikki RAW wiktextract dump (raw-wiktextract-data.jsonl.gz, gz streamed, filter lang_code); the per-language kaikki file is DEPRECATED; use aria2c -x16
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

**Use the RAW dump, not the per-language file (2026-08-25 follow-up).** @xxyzz (wiktextract
maintainer) flagged on #5737 that `kaikki.org-dictionary-English.jsonl` is post-processed for the
kaikki website and DEPRECATED (tatuylonen/wiktextract#1178; the links will be removed). The
supported source is `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz`: 2.8 GB gz,
~17 GB inflated, EVERY language section of the English Wiktionary (~1/4 of lines are
`lang_code: en`, plus redirect lines with no `word`). `streamJsonl` in the build script gunzips
`.gz` on the fly, so pass the gz path directly and never inflate it. Each build streams the whole
dump: en-vi 414 s, en-hu 321 s. Cached at `data/wordlens/.sources/raw-wiktextract-data.jsonl.gz`
(gitignored); the old `.sources/kaikki-en.jsonl` (3.2 GB) is the deprecated file and can go.
Fix = PR #5861, MERGED 2026-08-24 (8d44c6b66); worktree removed.

**The raw dump is BETTER data, not just the sanctioned file.** It keeps Wiktionary page order, so
the first translation is the primary sense; the post-processed file re-sorted senses. Rebuilding
from raw gave identical entry/inflection counts (en-vi 9,759/10,813; en-hu 13,641/15,753) but
334 en-vi and 652 en-hu entries changed their FIRST sense: `bear` "gấu" now precedes "đầu cơ giá
xuống" (bear-market speculator), `dying` "chết" replaces "thất sủng", en-hu `liked` "szeret"
replaces the social-media "lájkol". Both regenerated packs shipped in #5861 and the CDN manifest
carried their new sha256s right after merge (sync was run; verified 2026-08-25).

**kaikki throttles to ~270 KB/s per connection** but supports Range; `aria2c -x16 -s16` averaged
16 MiB/s on 2026-08-25 (2.8 GB in ~3 min; an earlier run took ~20 min for 3.2 GB). Always aria2c.

**vi is target-only, by data not by code.** Vietnamese words are multi-syllable with spaces
INSIDE them ("hoc sinh"), so the planner's whitespace tokenizer would gloss syllables. Nothing
gates `vi` in `canTokenizeSource` — the pack just doesn't exist, which is how every unbuilt pair
behaves. Adding a `vi-en` pack without a segmenter first would ship visible garbage.

**Coverage is thin: 9,759 entries vs 14,769 (en-es) / 14,926 (en-de)**, with the hole in the
4k-14k rank band where most learnable-difficult words live. That is Wiktionary's en->vi
translation coverage, not the build. Measured follow-up: Vietnamese Wiktionary's English section
(kaikki `viwiktionary/Tiếng Anh`, only 114 MB, 118,902 glossed English headwords; its raw dump is
`https://kaikki.org/viwiktionary/raw-wiktextract-data.jsonl.gz`, 33 MB gz) would add
**14,814** more words from the top-50k frequency list, taking the pack to ~24k. Its glosses are
real bilingual-dictionary entries ("Dấu, đốm, vết."), not encyclopedic definitions, so quality
holds — but merging needs a new build mode plus cleanup for trailing periods and "Quá khứ ... của
X" (form-of) glosses. Many form-of entries would self-clear via `finalizeInflections` when the
lemma is present. Deferred, not rejected.

Packs are served from R2, not bundled, so `WORDLENS_R2_BUCKET=<bucket> pnpm wordlens:sync` must
run after merge or clients never see `en-vi`. See [[wordlens-sync-incremental-5737]].
