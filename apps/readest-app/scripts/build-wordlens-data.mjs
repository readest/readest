// Build trimmed Word Lens gloss indices from open datasets.
//
//   node scripts/build-wordlens-data.mjs en-zh path/to/ecdict.csv [topN]
//   node scripts/build-wordlens-data.mjs en-en path/to/ecdict.csv [topN]
//   node scripts/build-wordlens-data.mjs zh-en path/to/cedict.txt path/to/hsk.json [topN]
//   node scripts/build-wordlens-data.mjs build <src> <tgt> <freq.txt> <gloss.jsonl> [topN]
//
// The generalized `build` mode assembles a pack for any (src→tgt) pair where one
// side is English, from two open datasets:
//   - FrequencyWords (CC-BY-SA-4.0): `word count` per line, descending → rank.
//   - kaikki Wiktionary extract (CC-BY-SA-4.0): JSONL, used for the gloss map.
//     tgt === 'en'  → foreign headword → English glosses (extractXToEn).
//     src === 'en'  → English headword → target-language words (extractEnToX).
//
// Outputs data/wordlens/<pair>.json in the GlossIndexData shape:
//   { meta, entries: { word: { r, g } }, inflections: { form: lemma } }
// plus data/wordlens/manifest.json indexing the available packs.
//
// ECDICT (MIT): columns word,phonetic,definition,translation,pos,collins,
//   oxford,tag,bnc,frq,exchange,detail,audio. We keep word, frq (rank),
//   a short translation (gloss), and parse `exchange` into an inflection map.
// CC-CEDICT (CC-BY-SA): lines `trad simp [pinyin] /sense/sense/`. HSK json
//   gives difficulty; higher HSK level => higher (rarer) rank.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  createReadStream,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';

const OUT_DIR = resolve('data/wordlens');
const TOP_DEFAULT = 30000;

// Keep a hint short + clean: drop bracket annotations ([医], [网络], [ge4]),
// leading part-of-speech tags (ECDICT "a." / "vt." / "n."), and CC-CEDICT
// classifier clauses (CL:...); then keep the first 1–2 senses.
export function shortGloss(s) {
  return s
    .split(/[;；/]/)
    .map((x) =>
      x
        .replace(/\[[^\]]*\]/g, '') // [医] [网络] [ge4] etc.
        .replace(/^\s*(?:[a-zA-Z]{1,5}\.\s*)+/, '') // leading POS: "a. " "vt. "
        .replace(/\bCL:[^;；/]*/g, '') // CC-CEDICT classifier clause
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 2)
    .join('；')
    .slice(0, 24);
}

// Connectors/articles/prepositions that read badly as the LAST word of a
// truncated gloss ("enjoying or showing or" → "enjoying or showing").
const TRAILING_FN_WORDS = new Set(
  'a an the of or and to in on for with at by as from'.split(' '),
);

// Clean one ECDICT definition sense: strip the leading POS code — a period-
// terminated abbreviation ("n." / "adv." / "interj.") OR a bare single-letter
// WordNet code without a period ("v" / "s"; the period is inconsistent in the
// data). A BARE leading "a" is the article and is kept — only "a." is the
// adjective code. Then drop [..] annotations and the example/qualifier clause
// after the first ";", collapse whitespace, and drop a Webster-style trailing dot.
function cleanDefSense(s) {
  return s
    .replace(/^\s*(?:(?:[a-zA-Z]{1,6}\.|[nvsr])\s+)+/, '')
    .replace(/\[[^\]]*\]/g, '')
    .split(';')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
}

// Shorten an ECDICT English `definition` (senses separated by a literal "\n")
// into a compact monolingual hint. Uses the FIRST non-empty cleaned sense (WordNet
// orders senses by importance, so the first is the primary meaning), then truncates
// on a word boundary to ≤24 chars — so the runtime cleanGloss's hard cap is a no-op,
// not a mid-word cut — and trims a dangling connector left by that truncation.
// A complete gloss already ≤24 is returned verbatim (no trim), so a phrasal gloss
// like "hold on to" keeps its tail. Returns '' when nothing usable.
export function shortDefGloss(def) {
  const senses = String(def || '')
    .split(/\\n/)
    .map(cleanDefSense)
    .filter(Boolean);
  if (!senses.length) return '';
  const sense = senses[0];
  if (sense.length <= 24) return sense;
  const cut = sense.slice(0, 24);
  const lastSpace = cut.lastIndexOf(' ');
  const words = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim().split(' ');
  while (words.length > 1 && TRAILING_FN_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(' ');
}

// Minimal CSV line parser (ECDICT quotes fields containing commas/newlines).
export function parseCsvLine(line) {
  if (line == null) return null;
  const out = [];
  let cur = '',
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ECDICT exchange tags: 0 lemma, 1 lemma-type, p past, d done, i ing, 3 3rd,
// r comparative, t superlative, s plural. Collect inflected forms (not the lemma).
export function parseExchange(exchange, word) {
  const forms = new Set();
  for (const part of exchange.split('/')) {
    const [tag, val] = part.split(':');
    if (!val) continue;
    if (['p', 'd', 'i', '3', 'r', 't', 's'].includes(tag)) forms.add(val);
  }
  forms.delete(word);
  return [...forms];
}

// Build an English-source index from ECDICT CSV *text* (so it's unit-testable).
// Shared by buildEnZh (gloss from the Chinese `translation`) and buildEnEn (gloss
// from the English `definition`). `glossColumn` is the ECDICT column to read and
// `makeGloss` turns that raw field into the trimmed hint; everything else (frq
// rank, exchange-based inflection map, drop-inflected-when-lemma-present) is shared.
function buildEnPack(csvText, topN, { target, glossColumn, makeGloss }) {
  const rows = csvText.split('\n');
  const header = parseCsvLine(rows[0]) ?? [];
  const col = (name) => header.indexOf(name);
  const iWord = col('word'),
    iGloss = col(glossColumn),
    iFrq = col('frq'),
    iEx = col('exchange');
  const entries = {};
  const inflections = {};
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const c = parseCsvLine(rows[i]);
    if (!c || !c[iWord]) continue;
    const frq = parseInt(c[iFrq] || '0', 10) || Number.MAX_SAFE_INTEGER;
    const g = makeGloss(c[iGloss] || '');
    if (!g) continue;
    parsed.push({ word: c[iWord], frq, g, exchange: c[iEx] || '' });
  }
  parsed.sort((a, b) => a.frq - b.frq);
  for (const e of parsed.slice(0, topN)) {
    entries[e.word.toLowerCase()] = { r: e.frq, g: e.g };
    // exchange: "p:past/i:ing/3:thirdperson/..." — map every form back to the lemma.
    // `parsed` is sorted most-common-first, so the FIRST lemma to claim a surface
    // form wins: ambiguous forms resolve to the most frequent lemma (e.g. "does"
    // -> "do", not "doe"; "putting" -> "put", not "putt").
    for (const form of parseExchange(e.exchange, e.word)) {
      const key = form.toLowerCase();
      if (!inflections[key]) inflections[key] = e.word.toLowerCase();
    }
  }
  // Drop standalone inflected-form entries (e.g. "kept", "children") when their
  // lemma is also present: at lookup the surface form resolves to the lemma via
  // `inflections`, so it inherits the lemma's difficulty rank + real gloss instead
  // of being judged on its own + showing a cross-reference ("keep的过去式…").
  for (const [form, lemma] of Object.entries(inflections)) {
    if (entries[form] && entries[lemma]) delete entries[form];
  }
  return {
    meta: { source: 'en', target, metric: 'frq', version: 1, count: Object.keys(entries).length },
    entries,
    inflections,
  };
}

// EN→中文: gloss from ECDICT's `translation` column (senses split by literal "\n").
export const buildEnZh = (csvText, topN) =>
  buildEnPack(csvText, topN, {
    target: 'zh',
    glossColumn: 'translation',
    makeGloss: (s) => shortGloss(s.replace(/\\n/g, '；')),
  });

// EN→EN (monolingual): gloss from ECDICT's English `definition` column.
export const buildEnEn = (csvText, topN) =>
  buildEnPack(csvText, topN, { target: 'en', glossColumn: 'definition', makeGloss: shortDefGloss });

// Parse one CC-CEDICT line: `傳統 传统 [chuan2 tong3] /tradition/traditional/`.
// Returns { simp, senses: [...] } or null for comments / malformed lines.
export function parseCedictLine(line) {
  if (!line || line.startsWith('#')) return null;
  const space = line.indexOf(' ');
  if (space === -1) return null;
  const rest = line.slice(space + 1);
  const space2 = rest.indexOf(' ');
  if (space2 === -1) return null;
  const simp = rest.slice(0, space2);
  if (!simp) return null;
  const firstSlash = line.indexOf('/');
  const lastSlash = line.lastIndexOf('/');
  if (firstSlash === -1 || lastSlash <= firstSlash) return null;
  const senses = line
    .slice(firstSlash + 1, lastSlash)
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!senses.length) return null;
  return { simp, senses };
}

// HSK json -> Map(word -> level). Tolerates either { "传统": 4 } or
// [{ "hanzi": "传统", "level": 4 }] shapes.
function buildHskLevels(hskJson) {
  const levels = new Map();
  if (Array.isArray(hskJson)) {
    for (const item of hskJson) {
      if (!item) continue;
      const word = item.hanzi ?? item.simplified ?? item.word;
      const level = Number(item.level ?? item.HSK ?? item.hsk);
      if (word && Number.isFinite(level)) levels.set(word, level);
    }
  } else if (hskJson && typeof hskJson === 'object') {
    for (const [word, level] of Object.entries(hskJson)) {
      const n = Number(level);
      if (Number.isFinite(n)) levels.set(word, n);
    }
  }
  return levels;
}

// Build the 中文→EN index from CC-CEDICT *text* + an HSK json object.
// Rank is derived from HSK level (higher level => rarer => higher rank); words
// absent from HSK fall back to a constant "advanced" rank. No inflections.
export function buildZhEn(cedictText, hskJson, topN) {
  const levels = buildHskLevels(hskJson);
  const rankForLevel = (level) => {
    if (!Number.isFinite(level) || level <= 0) return 20000;
    return Math.min(level, 9) * 3000;
  };
  const entries = {};
  const seen = new Set();
  const parsed = [];
  for (const line of cedictText.split('\n')) {
    const row = parseCedictLine(line.trim());
    if (!row) continue;
    // First simplified headword wins (CC-CEDICT lists variants on later lines).
    if (seen.has(row.simp)) continue;
    seen.add(row.simp);
    const g = shortGloss(row.senses.join('/'));
    if (!g) continue;
    const level = levels.get(row.simp);
    parsed.push({ word: row.simp, rank: rankForLevel(level), g });
  }
  // Lower rank (more common) first so topN keeps the most useful entries.
  parsed.sort((a, b) => a.rank - b.rank);
  for (const e of parsed.slice(0, topN)) {
    entries[e.word] = { r: e.rank, g: e.g };
  }
  return {
    meta: {
      source: 'zh',
      target: 'en',
      metric: 'hsk',
      version: 1,
      count: Object.keys(entries).length,
    },
    entries,
    inflections: {},
  };
}

// ---------------------------------------------------------------------------
// Generalized (frequency + Wiktionary) pack generation for any (src→tgt) pair.
// ---------------------------------------------------------------------------

// FrequencyWords text → [{ word, rank }]. Each non-blank line is `word count`;
// we keep the token before the first space (lowercased + trimmed); rank is the
// running 1-based index of kept lines (= difficulty rank, most common first).
export function parseFrequencyWords(text) {
  const out = [];
  let rank = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const word = trimmed.split(' ')[0].toLowerCase().trim();
    if (!word) continue;
    out.push({ word, rank: ++rank });
  }
  return out;
}

// Merge a foreign-headword entry's English glosses into the accumulator map.
// `glossMap` is Map(headword -> string[]); senses recur per POS so we merge
// and dedupe, capping at 4 glosses per headword. Returns nothing (mutates map).
function mergeXToEnEntry(obj, sourceCode, glossMap) {
  if (!obj || !obj.word) return;
  if (obj.lang_code && obj.lang_code !== sourceCode) return;
  const senses = Array.isArray(obj.senses) ? obj.senses : [];
  const glosses = [];
  for (const sense of senses) {
    const g = sense?.glosses?.[0];
    if (typeof g === 'string' && g.trim()) glosses.push(g.trim());
    if (glosses.length >= 4) break;
  }
  if (!glosses.length) return;
  const key = String(obj.word).toLowerCase().trim();
  if (!key) return;
  const existing = glossMap.get(key) ?? [];
  for (const g of glosses) {
    if (existing.length >= 4) break;
    if (!existing.includes(g)) existing.push(g);
  }
  glossMap.set(key, existing);
}

// X→en gloss map from in-memory JSONL text (used by tests). headword → glosses.
export function extractXToEn(jsonlText, sourceCode) {
  const glossMap = new Map();
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    mergeXToEnEntry(obj, sourceCode, glossMap);
  }
  return glossMap;
}

// Merge an English-headword entry's target-language translations into the map.
// Gathers sense-level translations then top-level ones; keeps t.code === target
// with a t.word; value = `${word} (${roman})` when a roman field is present.
function mergeEnToXEntry(obj, targetCode, glossMap) {
  if (!obj || !obj.word) return;
  if (obj.lang_code !== 'en') return;
  const collected = [];
  const consider = (t) => {
    if (!t || t.code !== targetCode || !t.word) return;
    const word = String(t.word).trim();
    if (!word) return;
    const value = t.roman ? `${word} (${String(t.roman).trim()})` : word;
    if (!collected.includes(value)) collected.push(value);
  };
  const senses = Array.isArray(obj.senses) ? obj.senses : [];
  for (const sense of senses) {
    for (const t of sense?.translations ?? []) consider(t);
  }
  for (const t of obj.translations ?? []) consider(t);
  if (!collected.length) return;
  const key = String(obj.word).toLowerCase().trim();
  if (!key) return;
  const existing = glossMap.get(key) ?? [];
  for (const v of collected) {
    if (existing.length >= 4) break;
    if (!existing.includes(v)) existing.push(v);
  }
  glossMap.set(key, existing);
}

// en→X gloss map from in-memory JSONL text (used by tests). headword → words.
export function extractEnToX(jsonlText, targetCode) {
  const glossMap = new Map();
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    mergeEnToXEntry(obj, targetCode, glossMap);
  }
  return glossMap;
}

// WikDict (DBnary/Wiktionary, CC-BY-SA-3.0): rows from the `simple_translation`
// table (written_rep, trans_list). trans_list is ` | `-joined, best-first.
// Returns Map(headword-lowercased -> string[] senses), merged + deduped, cap 6.
export function extractWikDict(rows) {
  const glossMap = new Map();
  for (const row of rows ?? []) {
    if (!row || !row.written_rep || !row.trans_list) continue;
    const key = String(row.written_rep).toLowerCase().trim();
    if (!key) continue;
    const senses = String(row.trans_list)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!senses.length) continue;
    const existing = glossMap.get(key) ?? [];
    for (const s of senses) {
      if (existing.length >= 6) break;
      if (!existing.includes(s)) existing.push(s);
    }
    glossMap.set(key, existing);
  }
  return glossMap;
}

// Parse a michmech-style lemmatization list (`lemma<TAB>form` per line, BOM-led)
// into a Map(form-lowercased -> lemma-lowercased). Used to lemmatize a non-English
// SOURCE language so an inflected word (e.g. Spanish "perros") gets glossed via its
// lemma ("perro"). First-wins on the rare ambiguous form.
export function parseLemmatizationList(text) {
  const map = new Map();
  for (const line of text.replace(/^﻿/, '').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const lemma = line.slice(0, tab).trim().toLowerCase();
    const form = line.slice(tab + 1).trim().toLowerCase();
    if (!lemma || !form || form === lemma) continue;
    if (!map.has(form)) map.set(form, lemma);
  }
  return map;
}

// Read a pack file's `inflections` map (form -> lemma) as a Map. Used to lemmatize
// English-source WikDict packs by reusing the en-zh pack's full inflection table.
export function inflectionMapFromPack(jsonText) {
  try {
    const infl = JSON.parse(jsonText).inflections || {};
    return new Map(Object.entries(infl));
  } catch {
    return new Map();
  }
}

// Stream a (possibly ~1 GB) JSONL file line-by-line, applying `perLine(obj)` to
// each parsed object. Shared by the streaming extractors so the CLI never holds
// the whole file in memory; parse errors are skipped silently.
async function streamJsonl(path, perLine) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    perLine(obj);
  }
}

// Streaming X→en (file path) — same per-line logic as extractXToEn.
export async function extractXToEnStream(path, sourceCode) {
  const glossMap = new Map();
  await streamJsonl(path, (obj) => mergeXToEnEntry(obj, sourceCode, glossMap));
  return glossMap;
}

// Streaming en→X (file path) — same per-line logic as extractEnToX.
export async function extractEnToXStream(path, targetCode) {
  const glossMap = new Map();
  await streamJsonl(path, (obj) => mergeEnToXEntry(obj, targetCode, glossMap));
  return glossMap;
}

// Assemble a pack in the GlossIndexData shape from a frequency list + gloss map.
// Walks freqList in order, skips the easiest `skipTop`, and emits up to `topN`
// entries; a surface word missing from glossMap falls back to its lemma (via
// lemmaMap). Inflections map each form to a lemma that is itself an entry.
export function buildPack({ freqList, glossMap, meta, topN = 30000, skipTop = 1000, lemmaMap = null }) {
  const entries = {};
  let count = 0;
  for (let i = skipTop; i < freqList.length; i++) {
    if (count >= topN) break;
    const { word, rank } = freqList[i];
    let senses = glossMap.get(word);
    if (!senses && lemmaMap) {
      const lemma = lemmaMap.get(word);
      if (lemma) senses = glossMap.get(lemma);
    }
    if (!senses || !senses.length) continue;
    const g = shortGloss(senses.join('；'));
    if (!g) continue;
    entries[word] = { r: rank, g };
    count++;
  }
  // Inflected surface forms resolve to their lemma's entry via `inflections`, so
  // drop any standalone inflected-form entry whose lemma is present (it then
  // inherits the lemma's difficulty rank + gloss instead of being glossed itself).
  const inflections = {};
  if (lemmaMap) {
    for (const [form, lemma] of lemmaMap) {
      if (!entries[lemma]) continue;
      delete entries[form];
      inflections[form] = lemma;
    }
  }
  return {
    meta: { ...meta, metric: 'frequency', version: 1, count: Object.keys(entries).length },
    entries,
    inflections,
  };
}

// Hex SHA-256 of a UTF-8 string (used for pack integrity in the manifest).
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Build a manifest pack entry from a pack file's name + its raw JSON text.
export function packEntry(file, jsonText) {
  const data = JSON.parse(jsonText);
  const source = data.meta?.source,
    target = data.meta?.target;
  if (!source || !target) return null; // not a pack file
  return {
    pair: `${source}-${target}`,
    source,
    target,
    file,
    bytes: Buffer.byteLength(jsonText, 'utf8'),
    sha256: sha256Hex(jsonText),
    entries: Object.keys(data.entries || {}).length,
  };
}

// Assemble the manifest object from pack entries (drops nulls, sorts by pair).
export function buildManifest(entries) {
  const packs = entries.filter(Boolean).sort((a, b) => a.pair.localeCompare(b.pair));
  return { schemaVersion: 1, packs };
}

// (Re)write manifest.json by scanning OUT_DIR for pack json files.
function writeManifest() {
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
  const entries = files.map((f) => packEntry(f, readFileSync(resolve(OUT_DIR, f), 'utf8')));
  const manifest = buildManifest(entries);
  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// CLI entry point — skipped when imported by tests.
async function main() {
  const [pair, ...rest] = process.argv.slice(2);
  mkdirSync(OUT_DIR, { recursive: true });
  if (pair === 'build') {
    const [src, tgt, freqPath, glossPath, topN] = rest;
    if (!src || !tgt || !freqPath || !glossPath)
      throw new Error(
        'usage: build-wordlens-data.mjs build <src> <tgt> <freq.txt> <gloss.jsonl> [topN]',
      );
    const freqList = parseFrequencyWords(readFileSync(freqPath, 'utf8'));
    let glossMap;
    if (tgt === 'en') {
      glossMap = await extractXToEnStream(glossPath, src);
    } else if (src === 'en') {
      glossMap = await extractEnToXStream(glossPath, tgt);
    } else {
      throw new Error("build: one side must be 'en'");
    }
    const meta = {
      source: src,
      target: tgt,
      license: 'CC-BY-SA-4.0',
      attribution:
        'Glosses: Wiktionary (CC-BY-SA-4.0) via kaikki.org. Frequency: hermitdave/FrequencyWords from OpenSubtitles/OPUS (CC-BY-SA-4.0).',
    };
    const data = buildPack({ freqList, glossMap, meta, topN: Number(topN) || TOP_DEFAULT });
    const file = `${src}-${tgt}.json`;
    writeFileSync(resolve(OUT_DIR, file), JSON.stringify(data));
    console.log(`${file}: ${data.meta.count} entries`);
    writeManifest();
  } else if (pair === 'build-wikdict') {
    const [src, tgt, freqPath, dbPath, topN, lemmaFile] = rest;
    if (!src || !tgt || !freqPath || !dbPath)
      throw new Error(
        'usage: build-wordlens-data.mjs build-wikdict <src> <tgt> <freq.txt> <wikdict.sqlite3> [topN] [lemma.txt]',
      );
    let rows;
    try {
      const json = execFileSync(
        'sqlite3',
        ['-json', dbPath, 'SELECT written_rep, trans_list FROM simple_translation'],
        { encoding: 'utf8', maxBuffer: 1 << 30 },
      );
      rows = json.trim() ? JSON.parse(json) : [];
    } catch (err) {
      throw new Error(
        `build-wikdict: failed to read ${dbPath} via the 'sqlite3' CLI (is sqlite3 installed?). ${err.message}`,
      );
    }
    const freqList = parseFrequencyWords(readFileSync(freqPath, 'utf8'));
    const glossMap = extractWikDict(rows);
    // Lemmatize the SOURCE language so inflected words are glossed via their lemma.
    // English source reuses the en-zh pack's inflection table ("kept"->"keep"); a
    // non-English source uses an optional michmech lemmatization list ("perros"->
    // "perro"). No-op if neither is available.
    let lemmaMap = null;
    const enZhPath = resolve(OUT_DIR, 'en-zh.json');
    if (src === 'en' && existsSync(enZhPath)) {
      lemmaMap = inflectionMapFromPack(readFileSync(enZhPath, 'utf8'));
    } else if (tgt === 'en' && lemmaFile && existsSync(lemmaFile)) {
      lemmaMap = parseLemmatizationList(readFileSync(lemmaFile, 'utf8'));
    }
    const meta = {
      source: src,
      target: tgt,
      license: 'CC-BY-SA-3.0',
      attribution:
        'Glosses: WikDict (CC-BY-SA-3.0), derived from DBnary/Wiktionary. Frequency: hermitdave/FrequencyWords from OpenSubtitles/OPUS (CC-BY-SA-4.0).',
    };
    const data = buildPack({ freqList, glossMap, meta, topN: Number(topN) || 20000, lemmaMap });
    const file = `${src}-${tgt}.json`;
    writeFileSync(resolve(OUT_DIR, file), JSON.stringify(data));
    console.log(`${file}: ${data.meta.count} entries`);
    writeManifest();
  } else if (pair === 'en-zh') {
    const [csv, topN] = rest;
    if (!csv) throw new Error('usage: build-wordlens-data.mjs en-zh <ecdict.csv> [topN]');
    const data = buildEnZh(readFileSync(csv, 'utf8'), Number(topN) || TOP_DEFAULT);
    writeFileSync(resolve(OUT_DIR, 'en-zh.json'), JSON.stringify(data));
    console.log(
      `en-zh.json: ${data.meta.count} entries, ${Object.keys(data.inflections).length} inflections`,
    );
    writeManifest();
  } else if (pair === 'en-en') {
    const [csv, topN] = rest;
    if (!csv) throw new Error('usage: build-wordlens-data.mjs en-en <ecdict.csv> [topN]');
    const data = buildEnEn(readFileSync(csv, 'utf8'), Number(topN) || TOP_DEFAULT);
    writeFileSync(resolve(OUT_DIR, 'en-en.json'), JSON.stringify(data));
    console.log(
      `en-en.json: ${data.meta.count} entries, ${Object.keys(data.inflections).length} inflections`,
    );
    writeManifest();
  } else if (pair === 'zh-en') {
    const [cedict, hsk, topN] = rest;
    if (!cedict || !hsk)
      throw new Error('usage: build-wordlens-data.mjs zh-en <cedict.txt> <hsk.json> [topN]');
    const data = buildZhEn(
      readFileSync(cedict, 'utf8'),
      JSON.parse(readFileSync(hsk, 'utf8')),
      Number(topN) || TOP_DEFAULT,
    );
    writeFileSync(resolve(OUT_DIR, 'zh-en.json'), JSON.stringify(data));
    console.log(`zh-en.json: ${data.meta.count} entries`);
    writeManifest();
  } else if (pair === 'manifest') {
    const m = writeManifest();
    console.log('manifest.json:', m.packs.length, 'packs');
  } else {
    throw new Error(
      'usage: build-wordlens-data.mjs <en-zh|en-en|zh-en|build|build-wikdict|manifest> <sources...> [topN]',
    );
  }
}

// Only run the CLI when executed directly (`node build-wordlens-data.mjs ...`),
// not when imported by the unit tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
