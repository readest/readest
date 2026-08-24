# Updating the Word Lens gloss packs

**Model:** the committed `data/wordlens/*.json` + `manifest.json` are the source of
truth. They are **not** bundled into the app — `pnpm wordlens:sync` mirrors them to the
`cdn.readest.com` R2 bucket, and the app downloads each pack on demand and **re-downloads
it automatically whenever its `sha256` changes in the manifest**. So updating data is:
regenerate → sync → commit. No app release required.

See `ATTRIBUTION.md` for the data sources + licenses.

## Prerequisites
- `sqlite3` CLI (for the WikDict pairs).
- `wrangler` logged in to Cloudflare + the R2 bucket name (for sync).
- A scratch dir for source corpora (e.g. `/tmp/ww-data`).

## 1. Fetch source corpora
```bash
mkdir -p /tmp/ww-data && cd /tmp/ww-data

# en→中文 + en→en: ECDICT (MIT) — ~66 MB
curl -sL -o ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv

# 中文→en: CC-CEDICT (CC-BY-SA) + HSK levels (drkameleon)
curl -sL -o cedict.txt.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz && gunzip -f cedict.txt.gz
for n in $(seq 1 9); do curl -sL -o hsk-$n.json https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/$n.json; done
node -e "const fs=require('fs');let o=[];for(let n=1;n<=9;n++){try{for(const it of JSON.parse(fs.readFileSync('hsk-'+n+'.json','utf8')))if(it.simplified)o.push({simplified:it.simplified,level:n});}catch(e){}}fs.writeFileSync('hsk.json',JSON.stringify(o))"

# Other pairs: WikDict SQLite (CC-BY-SA-3.0) + FrequencyWords (CC-BY-SA-4.0)
for c in en es fr de pt it ru; do curl -sL -o ${c}_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/$c/${c}_50k.txt; done
for p in es-en fr-en de-en pt-en it-en ru-en en-es en-fr en-de en-pt en-ru; do curl -sL -o $p.sqlite3 https://download.wikdict.com/dictionaries/sqlite/2/$p.sqlite3; done

# Source-language lemmatization lists (michmech) — used to lemmatize X→en source words
for c in es fr de pt it ru; do curl -sL -o lemmatization-$c.txt https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-$c.txt; done

# en→vi and en→hu: WikDict publishes neither Vietnamese nor Hungarian, so the glosses come
# from the kaikki.org raw wiktextract dump of the English Wiktionary (CC-BY-SA-4.0) — ~2.8 GB
# gzipped. It holds EVERY language section (English is ~1/4 of the lines); the build gunzips
# it on the fly and keeps only the `lang_code: en` entries, so do not inflate it (~17 GB).
# Do NOT download the per-language `kaikki.org-dictionary-<Language>.jsonl` files: they are
# post-processed for the website and DEPRECATED (tatuylonen/wiktextract#1178).
# One download serves every kaikki-sourced pair; use aria2c, not curl: kaikki throttles a
# single connection to ~270 KB/s (hours), while 16 parallel ranges finish in a few minutes.
aria2c -x16 -s16 -o raw-wiktextract-data.jsonl.gz https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz
```

## 2. Generate packs (run from `apps/readest-app`)
> **Order matters:** build `en-en` **first** — every en→X build reuses its English
> inflection + derivation table to lemmatize (enforced: en→X throws without `en-en.json`).
>
> **Lemmatization rule (all English-source pairs):** the gloss difficulty is gated by
> the LEMMA's frequency rank. `en-en`/`en-zh` (built directly via `buildEnPack`) resolve
> both inflected (`kept`→`keep`, via ECDICT `exchange`) AND transparently-derived forms
> (`thickly`→`thick`, `kindness`→`kind`, `insufferable`→`suffer`, via
> `enBaseFormCandidates` — suffixes `-ly/-ful/-ness/-less/-ward/-able/-ible` and negative
> prefixes `un-/in-/im-/ir-/il-`) to their lemma. A candidate is accepted when the ECDICT
> `definition` names the base OR the Chinese `translation` shares a content character with
> it (for meaning-shifting families whose def never names the base). Drift (`hardly`⇏
> `hard`) and coincidental stems (`ally`⇏`ale`, `capable`⇏`cap`) are rejected by both
> checks. en→X packs inherit this via the `en-en` table — `en-en` is the canonical
> English lemma source.
```bash
cd apps/readest-app

# Flagship pairs (dedicated dictionaries — higher quality)
node scripts/build-wordlens-data.mjs en-zh /tmp/ww-data/ecdict.csv 30000
node scripts/build-wordlens-data.mjs zh-en /tmp/ww-data/cedict.txt /tmp/ww-data/hsk.json 12000

# en→en (monolingual), short English hints for learners: a simpler SYNONYM → else a
# category (WordNet HYPERNYM) → else the ECDICT `definition` (first ≤2 senses). Packs
# store the FULL hint; the display-time length cap lives in `cleanGloss` (runtime), so
# changing it needs no regeneration. Needs WordNet (synsets + hypernyms):
# `npm pack wordnet-db && tar xzf wordnet-db-*.tgz` gives package/dict. Reuses ecdict.csv.
node scripts/build-wordlens-data.mjs en-en /tmp/ww-data/ecdict.csv /tmp/ww-data/package/dict 30000

# X→en (foreign source): pass the source-language lemmatization list (6th arg) so
# inflected source words ("corriendo" -> "correr") resolve to their lemma's gloss.
for src in es fr de pt it ru; do
  node scripts/build-wordlens-data.mjs build-wikdict "$src" en "/tmp/ww-data/${src}_50k.txt" "/tmp/ww-data/$src-en.sqlite3" 20000 "/tmp/ww-data/lemmatization-$src.txt"
done
# en→X (English source): lemmatized automatically via en-en.json (built above)
for tgt in es fr de pt ru; do
  node scripts/build-wordlens-data.mjs build-wikdict en "$tgt" /tmp/ww-data/en_50k.txt "/tmp/ww-data/en-$tgt.sqlite3" 20000
done

# en→vi, en→hu: no WikDict dictionary exists, so use the kaikki `build` mode instead — it
# reads the target-language `translations` off each English Wiktionary entry. Same
# lemmatization (en-en table) and same output shape as the WikDict pairs. Pass the .gz
# as is; each build streams the whole dump (5 to 7 min). The raw dump keeps Wiktionary page
# order, so the first translation is the primary sense; the deprecated post-processed file
# re-sorted senses (it glossed `bear` as "đầu cơ giá xuống" before "gấu").
for tgt in vi hu; do
  node scripts/build-wordlens-data.mjs build en "$tgt" /tmp/ww-data/en_50k.txt /tmp/ww-data/raw-wiktextract-data.jsonl.gz 20000
done
```
> **vi and hu are en-target only.** Vietnamese words are multi-syllable with spaces *inside*
> the word ("học sinh"), so the planner's whitespace tokenizer would gloss syllables, not
> words. Hungarian is agglutinative, so its surface forms ("házaimban") need a lemmatizer,
> and michmech publishes no Hungarian list. Both need that missing piece before a `vi-en` or
> `hu-en` pack would gloss anything useful — deferred, like ja/ko/th. (The Vietnamese
> Wiktionary's own raw dump, https://kaikki.org/viwiktionary/raw-wiktextract-data.jsonl.gz
> at ~33 MB, could widen `en-vi` from its English section, but its "past participle of X"
> form-of glosses need a new build mode plus cleanup — also deferred.)
- Each build writes `data/wordlens/<pair>.json` **and** regenerates `manifest.json`
  (sha256 + bytes + entry count). Rebuild only the manifest with `pnpm wordlens:manifest`.
- The last CLI arg is `topN` (default 30000 for en-zh, 20000 otherwise).
- **Add a new pair** (e.g. en→ja): fetch `en-ja.sqlite3` + `en_50k.txt`, run
  `build-wikdict en ja …` — it joins the manifest automatically. (ja/ko/th as a *source*
  language still need a word segmenter — deferred.)

> Max-coverage alternative to WikDict (heavier): the same kaikki raw dump via the
> `build <src> <tgt> <freq.txt> <raw-wiktextract-data.jsonl.gz>` mode — an X→en build keeps
> the `lang_code: <src>` entries of that one file — see `ATTRIBUTION.md`.

## 3. Sync to R2
```bash
WORDLENS_R2_BUCKET=<cdn-bucket> pnpm wordlens:sync           # only what changed
WORDLENS_R2_BUCKET=<cdn-bucket> pnpm wordlens:sync --force   # re-upload every pack
```
**Incremental:** the sync fetches the manifest already on the CDN and compares each
pack's `sha256`, so a one-pair refresh uploads that one pack, not all ~20 MB. Packs go
up first (immutable cache), `manifest.json` LAST (5-min cache) — and it is skipped
entirely if any pack failed, so the published manifest never references a pack the
bucket is missing. Use `--force` when the remote manifest is fine but an object was
deleted from the bucket; an unreachable manifest (first sync) falls back to a full upload.

## 4. Commit
```bash
git add data/wordlens && git commit -m "chore(wordlens): refresh gloss packs"
```

## 5. How clients update
On next load the app fetches `manifest.json` (≤5-min CDN cache), compares each pack's
`sha256` to the locally cached copy, and re-downloads any that changed. Nothing else to do.

## Tuning knobs
| What | Where |
| --- | --- |
| `topN` per pack | the build CLI's last arg |
| commonest-N words skipped (`skipTop`) + per-chapter render cap (`DEFAULT_CAP`) | `src/services/wordlens/{planner,…}` and `buildPack` in the build script |
| difficulty cutoffs per slider level | `src/services/wordlens/difficulty.ts` |
| gloss shaping in the pack (POS/`[…]`/`CL:` strip, ≤2 senses) | `shortGloss`/`shortDefGloss` in `scripts/build-wordlens-data.mjs` |
| display length cap (`MAX_GLOSS_LEN`, applied at render, no regen) | `cleanGloss` in `src/services/wordlens/gloss.ts` |
