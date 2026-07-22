// Build trimmed Word Lens gloss indices from open datasets.
//
//   node scripts/build-wordlens-data.mjs en-zh path/to/ecdict.csv [topN]
//   node scripts/build-wordlens-data.mjs en-en path/to/ecdict.csv path/to/wordnet/dict [topN]
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

// Keep a hint short + clean. ";"/"/" separate SENSES; within a sense, ","/"、"
// separate near-synonyms — keep only the first. Drop bracket annotations ([医],
// [网络], [ge4]), leading part-of-speech tags (ECDICT "a." / "vt." / "n."), and
// CC-CEDICT classifier clauses (CL:...); then keep at most the first two senses.
// NOTE: no length truncation here — the display length cap lives in cleanGloss
// (src/services/wordlens/gloss.ts), so it can change without regenerating packs.
export function shortGloss(s) {
  const senses = s
    .split(/[;；/]/)
    .map((x) =>
      x
        .replace(/\[[^\]]*\]/g, '') // [医] [网络] [ge4] etc.
        .replace(/^\s*(?:[a-zA-Z]{1,5}\.\s*)+/, '') // leading POS: "a. " "vt. "
        .replace(/\bCL:[^;；/]*/g, '') // CC-CEDICT classifier clause
        .replace(/\s+/g, ' ')
        .trim()
        .split(/[，,、]/)[0] // first synonym within the sense
        .trim(),
    )
    .filter(Boolean);
  return [...new Set(senses)] // dedupe: two senses can share a first synonym
    .slice(0, 2)
    .join('；');
}

// Clean one ECDICT definition line: strip the leading POS code — a period-
// terminated abbreviation ("n." / "adv." / "interj.") OR a bare single-letter
// WordNet code without a period ("v" / "s"; the period is inconsistent in the
// data). A BARE leading "a" is the article and is kept — only "a." is the
// adjective code. Then drop [..] annotations, collapse whitespace, and drop a
// Webster-style trailing dot. Keeps any ";" — those separate senses (see below).
function cleanDefSense(s) {
  return s
    .replace(/^\s*(?:(?:[a-zA-Z]{1,6}\.|[nvsr])\s+)+/, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
}

// Build the en-en gloss from an ECDICT English `definition` (lines separated by a
// literal "\n"). At most TWO senses: when ";"-joined, each ";" segment is a sense and
// the first two are kept; when there is no ";", the first two "\n" lines are kept;
// joined with "; ". No length truncation here — the display cap lives in cleanGloss.
export function shortDefGloss(def) {
  const lines = String(def || '')
    .split(/\\n/)
    .map(cleanDefSense)
    .filter(Boolean);
  if (!lines.length) return '';
  const senses = (
    lines.some((l) => l.includes(';'))
      ? lines.flatMap((l) => l.split(';').map((s) => s.trim())).filter(Boolean)
      : lines
  ).slice(0, 2);
  return senses.join('; ');
}

// --- WordNet hybrid: short en-en hints (simpler synonym → category → definition) ---

const cleanWnWord = (w) => w.replace(/\([^)]*\)$/, '').replace(/_/g, ' ').toLowerCase();
// WordNet pointer POS code → file. "s" (adjective satellite) lives in data.adj.
const PTR_POS = { n: 'noun', v: 'verb', a: 'adj', s: 'adj', r: 'adv' };

// Profane/vulgar synset members WordNet carries (jack/dump share a synset with
// "shit", rooster with "cock"); never surface them in a reading aid.
const PROFANE_GLOSS_WORDS = new Set(
  (
    'shit shite crap piss fuck fucking fucker motherfucker cunt cock cocksucker dick dickhead ' +
    'prick pussy bitch bastard asshole arsehole ass arse bugger bollocks slut whore turd wanker ' +
    'twat horseshit bullshit nigger faggot fag retard'
  ).split(' '),
);

// Over-generic WordNet hypernyms that don't explain anything — skip them so the hint
// falls through to a more specific category or the definition.
const GENERIC_HYPERNYMS = new Set([
  'entity', 'physical entity', 'abstract entity', 'object', 'thing', 'whole', 'unit', 'part',
  'portion', 'matter', 'substance', 'abstraction', 'group', 'grouping', 'collection',
  'arrangement', 'act', 'action', 'activity', 'event', 'state', 'condition', 'attribute',
  'property', 'quality', 'relation', 'magnitude', 'amount', 'measure', 'quantity', 'person',
  'individual', 'being', 'content', 'cognition', 'feeling', 'psychological feature',
  'phenomenon', 'artifact', 'instrumentality', 'device', 'structure', 'form',
]);

// Parse a WordNet data.<pos> file into byKey: `${pos}:${offset}` -> { members, hyper }.
// Synset line: "<offset> <lexfile> <ss_type> <w_cnt(hex)> <word> <lex_id> ... <p_cnt>
// [<ptr_symbol> <offset> <pos> <src/tgt>]... | gloss". "@"/"@i" pointers are the
// (instance) hypernym; we keep the first. Words use "_" for spaces, may carry a marker.
export function parseWordNetData(text, pos, byKey = new Map()) {
  for (const line of text.split('\n')) {
    if (!line || line[0] === ' ') continue;
    const t = line.split(' ');
    const wcnt = parseInt(t[3], 16);
    if (!Number.isFinite(wcnt) || wcnt < 1) continue;
    const members = [];
    for (let j = 0; j < wcnt; j++) {
      const raw = t[4 + 2 * j];
      if (raw) members.push(cleanWnWord(raw));
    }
    const hm = line.match(/ @i? (\d{8}) ([nvasr]) /);
    byKey.set(`${pos}:${t[0]}`, { members, hyper: hm ? `${PTR_POS[hm[2]]}:${hm[1]}` : null });
  }
  return byKey;
}

// Parse a WordNet index.<pos> file into lemma -> primary (first/most-frequent) synset
// offset for that POS.
export function parseWordNetIndex(text, map = new Map()) {
  for (const line of text.split('\n')) {
    if (!line || line[0] === ' ') continue;
    const t = line.split(' ');
    const lemma = cleanWnWord(t[0] || '');
    const offset = t.find((x) => /^\d{8}$/.test(x));
    if (lemma && offset && !map.has(lemma)) map.set(lemma, offset);
  }
  return map;
}

// Simplest synonym in a synset: the single, non-profane co-member with the lowest
// (most common) frequency that is STRICTLY more common than `word`. '' if none.
function simplestWnSynonym(word, key, byKey, frqMap) {
  const syn = byKey.get(key);
  if (!syn) return '';
  const own = frqMap.get(word) ?? Number.MAX_SAFE_INTEGER;
  let best = '',
    bestFrq = own;
  for (const m of syn.members) {
    if (m === word || m.includes(' ') || PROFANE_GLOSS_WORDS.has(m)) continue;
    const f = frqMap.get(m);
    if (f == null || f >= bestFrq) continue;
    bestFrq = f;
    best = m;
  }
  return best;
}

// The synset's hypernym category — first non-generic, non-self member. '' if none.
function wnHypernym(key, byKey, word) {
  const syn = byKey.get(key);
  if (!syn || !syn.hyper) return '';
  const h = byKey.get(syn.hyper);
  if (!h) return '';
  for (const m of h.members) {
    if (m === word || GENERIC_HYPERNYMS.has(m)) continue;
    return m;
  }
  return '';
}

// EN→EN hint: a simpler SYNONYM, else a category (HYPERNYM), else a short DEFINITION.
// POS priority (noun→verb→adj→adv) picks the dominant sense's synset without needing
// sense-frequency data, avoiding wrong-POS picks (the noun "ship" → "vessel", not the
// verb sense "send").
export function resolveEnEnGloss(word, rawDef, { byKey, primary, frqMap }) {
  const w = word.toLowerCase();
  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    const offset = primary[pos]?.get(w);
    if (!offset) continue;
    const key = `${pos}:${offset}`;
    const syn = simplestWnSynonym(w, key, byKey, frqMap);
    if (syn) return syn;
    const hyper = wnHypernym(key, byKey, w);
    if (hyper) return hyper;
  }
  return shortDefGloss(rawDef);
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

// Over-generate base forms for a transparent English derivation (lazily→lazy,
// thickly→thick, kindness→kind, harmless→harm). Mirrors baseFormCandidates in
// src/services/wordlens/gloss.ts. The caller validates each candidate against the
// entry table + the word's definition, so wrong guesses are harmless.
export function enBaseFormCandidates(word) {
  const w = word.toLowerCase();
  const out = new Set();
  const add = (x) => {
    if (x.length >= 2) out.add(x);
  };
  if (w.endsWith('ily') && w.length >= 5) add(w.slice(0, -3) + 'y'); // lazily → lazy
  if (w.endsWith('ly') && w.length >= 4) {
    add(w.slice(0, -2)); // shyly → shy, thickly → thick
    add(w.slice(0, -2) + 'e'); // nicely → nice
  }
  if (w.endsWith('ful') && w.length >= 5) {
    add(w.slice(0, -3)); // sorrowful → sorrow
    add(w.slice(0, -4) + 'y'); // beautiful → beauty
  }
  if (w.endsWith('wards') && w.length >= 6) {
    add(w.slice(0, -1)); // downwards → downward
    add(w.slice(0, -5)); // downwards → down
  } else if (w.endsWith('ward') && w.length >= 5) {
    add(w.slice(0, -4)); // inward → in
  }
  if (w.endsWith('ness') && w.length >= 5) {
    add(w.slice(0, -4)); // kindness → kind
    add(w.slice(0, -5) + 'y'); // happiness → happy
  }
  if (w.endsWith('less') && w.length >= 5) add(w.slice(0, -4)); // harmless → harm
  if ((w.endsWith('able') || w.endsWith('ible')) && w.length >= 6) {
    add(w.slice(0, -4)); // comfortable → comfort, sufferable → suffer
    add(w.slice(0, -4) + 'e'); // sensible → sense, lovable → love
  }
  // Negative/reversive prefixes (unhappy → happy, insufferable → suffer once -able is
  // stripped above): peel the prefix off the word and off each suffix candidate.
  for (const stem of [w, ...out]) {
    for (const p of ['un', 'in', 'im', 'ir', 'il']) {
      if (stem.startsWith(p) && stem.length - p.length >= 3) add(stem.slice(p.length));
    }
  }
  out.delete(w);
  return [...out];
}

// Does an entry's definition mention `base` as a whole word? Confirms a derivation
// is transparent (thickly's def names "thick") and rejects drift (hardly's def
// never says "hard") + coincidental string matches (ally's def never says "ale").
function defMentionsWord(def, base) {
  if (!def || base.length < 3) return false;
  return new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(def);
}

// Do a derived word and its candidate base share a content (Han) character in their
// Chinese translations? Confirms a transparent derivation whose English def doesn't
// name the base — meaning-shifting derivations like the negative -able/prefix family
// (insufferable/忍受 ⇐ suffer/忍受), while rejecting coincidental stems (capable ⇏ cap,
// 能力 vs 帽子). Particles carry no meaning and are stripped before the test.
const HAN_PARTICLES = /[的地得了着之吗呢啊，,；;、。.\s/]/g;
const HAN_CHAR = /\p{Script=Han}/u;
function transShareMeaning(a, b) {
  const an = (a || '').replace(HAN_PARTICLES, '');
  const bn = (b || '').replace(HAN_PARTICLES, '');
  if (!an || !bn) return false;
  const setB = new Set([...bn].filter((ch) => HAN_CHAR.test(ch)));
  return [...an].some((ch) => HAN_CHAR.test(ch) && setB.has(ch));
}

// Clean up a candidate form→lemma inflection map against the entry table, in place:
//   1. Prune a wrong link where the FORM is a more-common standalone entry than its
//      lemma — a primary word coincidentally matching an inflection pattern, not an
//      inflection (the noun "number", rank 300, wrongly claimed as numb's comparative).
//   2. Resolve chains to the terminal lemma ("paintings"→"painting"→"paint" becomes
//      "paintings"→"paint"), so a dropped middle form never leaves a dangling pointer.
//   3. Drop a form-entry whose terminal lemma is a present entry (it resolves to the
//      lemma at lookup); drop the mapping entirely when the terminal isn't an entry.
// Postcondition: every inflection's lemma is an entry, and no inflected form is also
// an entry.
export function finalizeInflections(entries, inflections) {
  for (const [form, lemma] of Object.entries(inflections)) {
    const fe = entries[form];
    const le = entries[lemma];
    if (fe && le && fe.r < le.r) delete inflections[form]; // form outranks its "lemma"
  }
  for (const form of Object.keys(inflections)) {
    let lemma = inflections[form];
    const seen = new Set([form]);
    while (inflections[lemma] && !seen.has(lemma)) {
      seen.add(lemma);
      lemma = inflections[lemma];
    }
    // Stopped with `lemma` still a key ⇒ a cycle (ambiguous mutual inflections,
    // e.g. "axes"↔"axis"); don't lemmatize this form — leave it a standalone entry.
    if (inflections[lemma]) delete inflections[form];
    else inflections[form] = lemma;
  }
  for (const [form, lemma] of Object.entries(inflections)) {
    if (!entries[lemma]) delete inflections[form]; // terminal not an entry → no dangling
    else if (entries[form]) delete entries[form]; // resolves to its lemma at lookup
  }
}

// Build an English-source index from ECDICT CSV *text* (so it's unit-testable).
// Shared by buildEnZh (gloss from the Chinese `translation`) and buildEnEn (gloss
// from the English `definition`). `glossColumn` is the ECDICT column to read and
// `makeGloss` turns that raw field into the trimmed hint; everything else — frq
// rank, exchange-based inflection map, drop-inflected-when-lemma-present, and the
// derivational lemmatization below — is shared. Lemmatizing both inflected AND
// transparently-derived forms to their base, so the difficulty check runs against
// the LEMMA's frequency rank, is a workflow rule for every English-source pair.
function buildEnPack(csvText, topN, { target, glossColumn, makeGloss }) {
  const rows = csvText.split('\n');
  const header = parseCsvLine(rows[0]) ?? [];
  const col = (name) => header.indexOf(name);
  const iWord = col('word'),
    iGloss = col(glossColumn),
    iDef = col('definition'),
    iTrans = col('translation'),
    iFrq = col('frq'),
    iEx = col('exchange');
  // Pass 1: parse rows + build a word→frq map (a gloss builder may pick the simplest
  // synonym by frequency, e.g. en-en's WordNet hybrid).
  const raw = [];
  const frqMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const c = parseCsvLine(rows[i]);
    if (!c || !c[iWord]) continue;
    const word = c[iWord];
    const frq = parseInt(c[iFrq] || '0', 10) || Number.MAX_SAFE_INTEGER;
    const key = word.toLowerCase();
    const prev = frqMap.get(key);
    if (prev == null || frq < prev) frqMap.set(key, frq);
    raw.push({
      word,
      frq,
      gloss: c[iGloss] || '',
      def: c[iDef] || '',
      trans: c[iTrans] || '',
      exchange: c[iEx] || '',
    });
  }
  // Pass 2: build the final gloss for each row.
  const entries = {};
  const inflections = {};
  const defByWord = new Map(); // lowercased word -> raw English definition (for lemmatization)
  const transByWord = new Map(); // lowercased word -> Chinese translation (for lemmatization)
  const parsed = [];
  for (const r of raw) {
    const g = makeGloss(r.gloss, { word: r.word, frqMap });
    if (!g) continue;
    parsed.push({ word: r.word, frq: r.frq, g, exchange: r.exchange, def: r.def, trans: r.trans });
  }
  parsed.sort((a, b) => a.frq - b.frq);
  for (const e of parsed.slice(0, topN)) {
    const key = e.word.toLowerCase();
    entries[key] = { r: e.frq, g: e.g };
    defByWord.set(key, e.def);
    transByWord.set(key, e.trans);
    // exchange: "p:past/i:ing/3:thirdperson/..." — map every form back to the lemma.
    // `parsed` is sorted most-common-first, so the FIRST lemma to claim a surface
    // form wins: ambiguous forms resolve to the most frequent lemma (e.g. "does"
    // -> "do", not "doe"; "putting" -> "put", not "putt").
    for (const form of parseExchange(e.exchange, e.word)) {
      const f = form.toLowerCase();
      if (!inflections[f]) inflections[f] = key;
    }
  }
  // Candidate transparent DERIVATIONS (thickly⇐thick, kindness⇐kind, insufferable⇐
  // suffer): a base that is also an entry AND either named by this word's English
  // definition OR sharing a Han character in its Chinese translation (for meaning-
  // shifting families like negative -able/prefix, whose def never names the base).
  // Both checks reject drift (hardly⇏hard) and coincidental stems (ally⇏ale, capable⇏
  // cap). Recorded alongside the exchange inflections; finalizeInflections does the drop.
  for (const word of Object.keys(entries)) {
    if (inflections[word]) continue; // an exchange inflection already claimed it
    for (const base of enBaseFormCandidates(word)) {
      if (
        entries[base] &&
        (defMentionsWord(defByWord.get(word), base) ||
          transShareMeaning(transByWord.get(word), transByWord.get(base)))
      ) {
        inflections[word] = base;
        break;
      }
    }
  }
  finalizeInflections(entries, inflections);
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

// EN→EN (monolingual): short hint = a simpler synonym, else a category (hypernym),
// else a trimmed definition (see resolveEnEnGloss). `wordnet` is { byKey, primary }
// from parseWordNetData/parseWordNetIndex. ECDICT supplies the frequency rank +
// inflections, so difficulty is identical to en-zh.
export const buildEnEn = (csvText, wordnet, topN) =>
  buildEnPack(csvText, topN, {
    target: 'en',
    glossColumn: 'definition',
    makeGloss: (rawDef, { word, frqMap }) =>
      resolveEnEnGloss(word, rawDef, { byKey: wordnet.byKey, primary: wordnet.primary, frqMap }),
  });

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
  // Inflected/derived surface forms resolve to their lemma's entry via `inflections`,
  // so drop any standalone form-entry whose lemma is present. finalizeInflections
  // prunes lemmas not present here, resolves chains, and rejects wrong collisions.
  const inflections = {};
  if (lemmaMap) {
    for (const [form, lemma] of lemmaMap) inflections[form] = lemma;
    finalizeInflections(entries, inflections);
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

// Every English-SOURCE pack must lemmatize via the en-en inflection table — the
// canonical English inflection + derivation map. en-en is the English-native pack,
// and its definition-present entry set is exactly what the derivational lemmatizer
// validates against, so it's the proper source of truth. Enforced: en-en must exist
// first, or this throws instead of silently shipping an un-lemmatized en-X pack.
// (en-en / en-zh build the table directly via buildEnPack.)
function requireEnLemmaMap() {
  const enEnPath = resolve(OUT_DIR, 'en-en.json');
  if (!existsSync(enEnPath)) {
    throw new Error(
      'English-source builds require data/wordlens/en-en.json for lemmatization ' +
        '(inflections + derivations). Build en-en first.',
    );
  }
  return inflectionMapFromPack(readFileSync(enEnPath, 'utf8'));
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
    // English-source packs must lemmatize via the en-zh table (enforced).
    const lemmaMap = src === 'en' ? requireEnLemmaMap() : null;
    const data = buildPack({ freqList, glossMap, meta, topN: Number(topN) || TOP_DEFAULT, lemmaMap });
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
    // English source MUST reuse the en-en inflection + derivation table ("kept"->
    // "keep", "thickly"->"thick") — enforced via requireEnLemmaMap (throws if en-en
    // is missing). A non-English source uses an optional michmech lemmatization list
    // ("perros"->"perro").
    let lemmaMap = null;
    if (src === 'en') {
      lemmaMap = requireEnLemmaMap();
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
    const [csv, wnDir, topN] = rest;
    if (!csv || !wnDir)
      throw new Error('usage: build-wordlens-data.mjs en-en <ecdict.csv> <wordnet-dict-dir> [topN]');
    const byKey = new Map();
    const primary = { noun: new Map(), verb: new Map(), adj: new Map(), adv: new Map() };
    for (const pos of ['noun', 'verb', 'adj', 'adv']) {
      parseWordNetData(readFileSync(resolve(wnDir, `data.${pos}`), 'utf8'), pos, byKey);
      parseWordNetIndex(readFileSync(resolve(wnDir, `index.${pos}`), 'utf8'), primary[pos]);
    }
    const data = buildEnEn(readFileSync(csv, 'utf8'), { byKey, primary }, Number(topN) || TOP_DEFAULT);
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
