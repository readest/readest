import { describe, it, expect } from 'vitest';
// Import the real exported helpers from the .mjs build script (vitest/vite can
// import ESM .mjs directly), so the test exercises the actual logic.
import {
  parseCsvLine,
  parseExchange,
  shortGloss,
  shortDefGloss,
  sha256Hex,
  packEntry,
  buildManifest,
  buildEnZh as buildEnZhUntyped,
  buildEnEn as buildEnEnUntyped,
  buildZhEn as buildZhEnUntyped,
  parseFrequencyWords as parseFrequencyWordsUntyped,
  extractXToEn as extractXToEnUntyped,
  extractEnToX as extractEnToXUntyped,
  extractWikDict as extractWikDictUntyped,
  inflectionMapFromPack as inflectionMapFromPackUntyped,
  parseLemmatizationList as parseLemmatizationListUntyped,
  buildPack as buildPackUntyped,
} from '../../../scripts/build-wordlens-data.mjs';
import type { GlossIndexData } from '@/services/wordlens/types';

// The .mjs script has no type annotations; pin the builders' returns to the
// real GlossIndexData shape so the assertions are type-checked.
const buildEnZh = buildEnZhUntyped as (csvText: string, topN: number) => GlossIndexData;
const buildEnEn = buildEnEnUntyped as (csvText: string, topN: number) => GlossIndexData;
const buildZhEn = buildZhEnUntyped as (
  cedictText: string,
  hskJson: unknown,
  topN: number,
) => GlossIndexData;

interface FreqEntry {
  word: string;
  rank: number;
}
const parseFrequencyWords = parseFrequencyWordsUntyped as (text: string) => FreqEntry[];
const extractXToEn = extractXToEnUntyped as (
  jsonlText: string,
  sourceCode: string,
) => Map<string, string[]>;
const extractEnToX = extractEnToXUntyped as (
  jsonlText: string,
  targetCode: string,
) => Map<string, string[]>;
const extractWikDict = extractWikDictUntyped as (
  rows: { written_rep: string; trans_list: string }[],
) => Map<string, string[]>;
const inflectionMapFromPack = inflectionMapFromPackUntyped as (
  jsonText: string,
) => Map<string, string>;
const parseLemmatizationList = parseLemmatizationListUntyped as (
  text: string,
) => Map<string, string>;
const buildPack = buildPackUntyped as (args: {
  freqList: FreqEntry[];
  glossMap: Map<string, string[]>;
  meta: Record<string, string>;
  topN?: number;
  skipTop?: number;
  lemmaMap?: Map<string, string> | null;
}) => GlossIndexData;

describe('parseCsvLine', () => {
  it('keeps a quoted field containing a comma intact', () => {
    const cols = parseCsvLine('run,/rʌn/,"to run, operate",312');
    expect(cols).toEqual(['run', '/rʌn/', 'to run, operate', '312']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const cols = parseCsvLine('word,"a ""quoted"" word",1');
    expect(cols).toEqual(['word', 'a "quoted" word', '1']);
  });
});

describe('parseExchange', () => {
  it('returns inflected forms and excludes the lemma', () => {
    const forms = parseExchange('p:ran/i:running/3:runs/0:run', 'run');
    expect(forms.sort()).toEqual(['ran', 'running', 'runs']);
    expect(forms).not.toContain('run');
  });

  it('ignores tags outside the inflection set', () => {
    // 0 = lemma, 1 = lemma-type: not inflected forms.
    const forms = parseExchange('0:run/1:i', 'ran');
    expect(forms).toEqual([]);
  });
});

describe('shortGloss', () => {
  it('truncates to the first 1-2 senses joined by ；and ≤24 chars', () => {
    const g = shortGloss('to run; to operate; to manage; foo');
    expect(g).toBe('to run；to operate');
    expect(g.length).toBeLessThanOrEqual(24);
  });

  it('caps overly long senses at 24 chars', () => {
    const g = shortGloss('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(g.length).toBe(24);
  });

  it('strips leading POS tags, bracket annotations, and CL: clauses', () => {
    expect(shortGloss('a. 神秘的')).toBe('神秘的');
    expect(shortGloss('vt. 做；vi. 看')).toBe('做；看');
    expect(shortGloss('[网络] 隐；晦涩的')).toBe('隐；晦涩的');
    expect(shortGloss('government/CL:個|个[ge4]')).toBe('government');
  });
});

describe('shortDefGloss', () => {
  it('uses the first (primary) sense, not a shorter later one', () => {
    // ECDICT separates senses in `definition` with a literal "\n" (backslash-n);
    // WordNet orders them by importance, so the first sense is the primary meaning.
    const def = String.raw`a. enjoying or showing joy\ns. well expressed and to the point`;
    expect(shortDefGloss(def)).toBe('enjoying or showing joy');
  });

  it('strips WordNet POS codes with or without a period (n./v/a./s/r)', () => {
    expect(shortDefGloss('v take the first step')).toBe('take the first step');
    expect(shortDefGloss('s being present')).toBe('being present');
    expect(shortDefGloss('a. enjoying joy')).toBe('enjoying joy');
    // a bare leading "a" is the article, not the adjective POS code → kept.
    expect(shortDefGloss('n. a small house')).toBe('a small house');
  });

  it('drops the example/qualifier clause after the first ";"', () => {
    expect(shortDefGloss('informal or natural; especially caught off guard')).toBe(
      'informal or natural',
    );
  });

  it('word-boundary truncates to <= 24 and trims a dangling connector', () => {
    const g = shortDefGloss('enjoying or showing or marked by joy or pleasure');
    expect(g.length).toBeLessThanOrEqual(24);
    expect(g).toBe('enjoying or showing');
  });

  it('keeps a complete short gloss that ends in a preposition (no over-trim)', () => {
    expect(shortDefGloss('hold on to')).toBe('hold on to');
  });

  it('strips multi-letter POS abbreviations too (adv./conj./interj.)', () => {
    expect(shortDefGloss('adv. in a quick manner')).toBe('in a quick manner');
    expect(shortDefGloss('interj. Same as Ha')).toBe('Same as Ha');
  });

  it('drops a Webster-style trailing period', () => {
    expect(shortDefGloss('A magician.')).toBe('A magician');
  });

  it('strips bracket annotations', () => {
    expect(shortDefGloss('a happy state [psychology]')).toBe('a happy state');
  });

  it('returns empty string for empty / whitespace-only / all-empty senses', () => {
    expect(shortDefGloss('')).toBe('');
    expect(shortDefGloss('   ')).toBe('');
    expect(shortDefGloss(String.raw`\n  \n`)).toBe('');
  });
});

describe('buildEnEn', () => {
  const header =
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';
  const csv = [
    header,
    'Run,/rʌn/,move fast on foot,跑；经营,v,3,,,100,312,p:ran/i:running/3:runs/0:run,,',
    String.raw`cryptic,/ˈkrɪptɪk/,having a hidden meaning\nmysterious,晦涩的,adj,2,,,500,18000,,,`,
  ].join('\n');

  it('produces en/en GlossIndexData with glosses from the definition column', () => {
    const data = buildEnEn(csv, 100);
    expect(data.meta).toEqual({
      source: 'en',
      target: 'en',
      metric: 'frq',
      version: 1,
      count: 2,
    });
    // headword lowercased, r from frq, g from the definition column (not translation).
    expect(data.entries['run']).toEqual({ r: 312, g: 'move fast on foot' });
    // first (primary) sense wins: "having a hidden meaning" over the later "mysterious".
    expect(data.entries['cryptic']).toEqual({ r: 18000, g: 'having a hidden meaning' });
    // exchange forms map back to the lemma; the lemma itself is not an inflection.
    expect(data.inflections['ran']).toBe('run');
    expect(data.inflections['running']).toBe('run');
    expect(data.inflections['runs']).toBe('run');
    expect(data.inflections['run']).toBeUndefined();
  });

  it('skips a row whose definition is empty', () => {
    const data = buildEnEn([header, 'word,/x/,,无,n,1,,,1,10,,,'].join('\n'), 100);
    expect(data.entries['word']).toBeUndefined();
    expect(data.meta.count).toBe(0);
  });

  it('drops an inflected-form entry when its lemma is present (lemmatize)', () => {
    const csv2 = [
      header,
      'keep,/kiːp/,hold on to,保持,v,5,,,50,120,p:kept/i:keeping/3:keeps,,',
      'kept,/kept/,past tense of keep,过去式,v,,,,800,2500,,,',
    ].join('\n');
    const data = buildEnEn(csv2, 100);
    expect(data.entries['kept']).toBeUndefined();
    expect(data.entries['keep']).toEqual({ r: 120, g: 'hold on to' });
    expect(data.inflections['kept']).toBe('keep');
    expect(data.meta.count).toBe(1);
  });
});

describe('buildEnZh', () => {
  const header =
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';
  // ECDICT separates senses in `translation` with a literal "\n" (backslash-n),
  // which buildEnZh rewrites to ；before shortGloss runs.
  const csv = [
    header,
    'Run,/rʌn/,def,跑；经营,v,3,,,100,312,p:ran/i:running/3:runs/0:run,,',
    String.raw`cryptic,/ˈkrɪptɪk/,def,"晦涩的\n神秘的",adj,2,,,500,18000,,,`,
  ].join('\n');

  it('produces a GlossIndexData shape with lowercased headwords from the CSV text', () => {
    const data = buildEnZh(csv, 100);
    expect(data.meta).toEqual({
      source: 'en',
      target: 'zh',
      metric: 'frq',
      version: 1,
      count: 2,
    });
    // headword lowercased, r from frq, g from translation.
    expect(data.entries['run']).toEqual({ r: 312, g: '跑；经营' });
    expect(data.entries['cryptic']).toEqual({ r: 18000, g: '晦涩的；神秘的' });
    // exchange forms map back to the lemma; lemma itself is not an inflection.
    expect(data.inflections['ran']).toBe('run');
    expect(data.inflections['running']).toBe('run');
    expect(data.inflections['runs']).toBe('run');
    expect(data.inflections['run']).toBeUndefined();
  });

  it('honours topN by frequency rank (keeps the most common)', () => {
    const data = buildEnZh(csv, 1);
    expect(Object.keys(data.entries)).toEqual(['run']);
    expect(data.meta.count).toBe(1);
  });

  it('resolves an ambiguous inflected form to the most frequent lemma (first-wins)', () => {
    // Both "do" (common) and "doe" (rare) claim the form "does"; the more frequent
    // lemma must win so "does" -> "do", not "doe".
    const ambiguous = [
      header,
      'do,/duː/,def,做,v,5,,,5,30,3:does/p:did,,',
      'doe,/dəʊ/,def,母鹿,n,1,,,9000,15000,s:does,,',
    ].join('\n');
    const data = buildEnZh(ambiguous, 100);
    expect(data.inflections['does']).toBe('do');
  });

  it('drops an inflected-form entry when its lemma is present (lemmatize)', () => {
    const lemmaInfl = [
      header,
      'keep,/kiːp/,def,保持；保留,v,5,,,50,120,p:kept/d:kept/i:keeping/3:keeps,,',
      'kept,/kept/,def,keep的过去式和过去分词,v,,,,800,2500,,,',
    ].join('\n');
    const data = buildEnZh(lemmaInfl, 100);
    // "kept" is not a standalone entry; it resolves to "keep" via inflections.
    expect(data.entries['kept']).toBeUndefined();
    expect(data.entries['keep']).toEqual({ r: 120, g: '保持；保留' });
    expect(data.inflections['kept']).toBe('keep');
    expect(data.meta.count).toBe(1);
  });
});

describe('buildZhEn', () => {
  const cedict = [
    '# CC-CEDICT comment line',
    '傳統 传统 [chuan2 tong3] /tradition/traditional/',
    '斟酌 斟酌 [zhen1 zhuo2] /to consider/to weigh/to deliberate/',
    '傳統 传统 [chuan2 tong3] /variant entry/', // duplicate simplified: ignored
  ].join('\n');

  it('parses simplified headwords with first English sense via shortGloss, no inflections', () => {
    const data = buildZhEn(cedict, { 传统: 4 }, 100);
    expect(data.meta.source).toBe('zh');
    expect(data.meta.target).toBe('en');
    expect(data.inflections).toEqual({});
    // simplified headword, first 1-2 senses joined by ；
    expect(data.entries['传统']).toEqual({ r: 12000, g: 'tradition；traditional' });
    expect(data.entries['斟酌']).toEqual({ r: 20000, g: 'to consider；to weigh' });
    // duplicate simplified line did not add a second entry.
    expect(data.meta.count).toBe(2);
  });

  it('derives a higher (rarer) rank for a higher HSK level', () => {
    const hsk2 = buildZhEn(cedict, { 传统: 2 }, 100).entries['传统']!.r;
    const hsk6 = buildZhEn(cedict, { 传统: 6 }, 100).entries['传统']!.r;
    expect(hsk6).toBeGreaterThan(hsk2);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 hex of "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('packEntry', () => {
  it('builds a manifest entry from a pack file name + its raw JSON text', () => {
    const jsonText = JSON.stringify({
      meta: { source: 'en', target: 'zh' },
      entries: { run: { r: 1, g: '跑' } },
    });
    expect(packEntry('en-zh.json', jsonText)).toEqual({
      pair: 'en-zh',
      source: 'en',
      target: 'zh',
      file: 'en-zh.json',
      bytes: Buffer.byteLength(jsonText, 'utf8'),
      sha256: sha256Hex(jsonText),
      entries: 1,
    });
  });

  it('returns null for a JSON file without pack meta', () => {
    expect(packEntry('x.json', JSON.stringify({ entries: {} }))).toBeNull();
  });
});

describe('buildManifest', () => {
  it('returns a schemaVersion-1 manifest with packs sorted by pair', () => {
    const entryA = {
      pair: 'en-zh',
      source: 'en',
      target: 'zh',
      file: 'en-zh.json',
      bytes: 10,
      sha256: 'a',
      entries: 1,
    };
    const entryB = {
      pair: 'zh-en',
      source: 'zh',
      target: 'en',
      file: 'zh-en.json',
      bytes: 20,
      sha256: 'b',
      entries: 2,
    };
    expect(buildManifest([entryB, entryA])).toEqual({
      schemaVersion: 1,
      packs: [entryA, entryB],
    });
  });
});

describe('parseFrequencyWords', () => {
  it('takes the token before the first space, 1-based rank, skipping blanks', () => {
    expect(parseFrequencyWords('the 100\nde 90\n\nla 80')).toEqual([
      { word: 'the', rank: 1 },
      { word: 'de', rank: 2 },
      { word: 'la', rank: 3 },
    ]);
  });

  it('lowercases and trims the word and skips malformed lines', () => {
    expect(parseFrequencyWords('  El 5\n\n  \nLOS 3')).toEqual([
      { word: 'el', rank: 1 },
      { word: 'los', rank: 2 },
    ]);
  });
});

describe('extractXToEn', () => {
  const jsonl = [
    JSON.stringify({
      word: 'perro',
      lang_code: 'es',
      senses: [{ glosses: ['dog'] }, { glosses: ['scoundrel'] }],
    }),
    JSON.stringify({ word: 'hund', lang_code: 'de', senses: [{ glosses: ['dog'] }] }),
  ].join('\n');

  it('maps the foreign headword to its english glosses and excludes wrong-lang lines', () => {
    const map = extractXToEn(jsonl, 'es');
    expect(map.get('perro')).toEqual(['dog', 'scoundrel']);
    expect(map.has('hund')).toBe(false);
  });

  it('merges senses across recurring headwords and skips parse errors', () => {
    const text = [
      'not json at all',
      JSON.stringify({
        word: 'casa',
        lang_code: 'es',
        pos: 'noun',
        senses: [{ glosses: ['house'] }],
      }),
      JSON.stringify({
        word: 'Casa',
        lang_code: 'es',
        pos: 'verb',
        senses: [{ glosses: ['to marry'] }],
      }),
    ].join('\n');
    expect(extractXToEn(text, 'es').get('casa')).toEqual(['house', 'to marry']);
  });
});

describe('extractEnToX', () => {
  const enEntry = JSON.stringify({
    word: 'dog',
    lang_code: 'en',
    senses: [
      {
        glosses: ['animal'],
        translations: [
          { code: 'es', word: 'perro' },
          { code: 'fr', word: 'chien' },
        ],
      },
    ],
    translations: [{ code: 'es', word: 'perro' }],
  });

  it('collects target translations deduped across sense + top-level', () => {
    expect(extractEnToX(enEntry, 'es').get('dog')).toEqual(['perro']);
    expect(extractEnToX(enEntry, 'fr').get('dog')).toEqual(['chien']);
  });

  it('appends a roman field in parens when present', () => {
    const ru = JSON.stringify({
      word: 'dog',
      lang_code: 'en',
      translations: [{ code: 'ru', word: 'собака', roman: 'sobaka' }],
    });
    expect(extractEnToX(ru, 'ru').get('dog')).toEqual(['собака (sobaka)']);
  });
});

describe('buildPack', () => {
  const meta = {
    source: 'es',
    target: 'en',
    license: 'CC-BY-SA-4.0',
    attribution: 'Glosses: Wiktionary. Frequency: FrequencyWords.',
  };

  it('skips the easiest skipTop words, honours topN, drops words lacking a gloss', () => {
    const freqList: FreqEntry[] = [
      { word: 'la', rank: 1 }, // within skipTop:1 -> skipped
      { word: 'perro', rank: 2 },
      { word: 'gato', rank: 3 },
      { word: 'xyzzy', rank: 4 }, // no gloss -> dropped
      { word: 'casa', rank: 5 },
    ];
    const glossMap = new Map<string, string[]>([
      ['la', ['the']],
      ['perro', ['dog']],
      ['gato', ['cat']],
      ['casa', ['house']],
    ]);
    const data = buildPack({ freqList, glossMap, meta, topN: 2, skipTop: 1 });
    expect(Object.keys(data.entries)).toEqual(['perro', 'gato']);
    expect(data.entries['perro']).toEqual({ r: 2, g: 'dog' });
    expect(typeof data.entries['perro']!.g).toBe('string');
    expect(data.entries['gato']!.r).toBe(3);
    expect(data.inflections).toEqual({});
    expect(data.meta).toEqual({
      source: 'es',
      target: 'en',
      license: 'CC-BY-SA-4.0',
      attribution: 'Glosses: Wiktionary. Frequency: FrequencyWords.',
      metric: 'frequency',
      version: 1,
      count: 2,
    });
  });

  it('resolves a surface form via lemmaMap and emits inflections only for present lemmas', () => {
    const freqList: FreqEntry[] = [
      { word: 'perros', rank: 1 },
      { word: 'gatos', rank: 2 },
    ];
    const glossMap = new Map<string, string[]>([['perro', ['dog']]]);
    const lemmaMap = new Map<string, string>([
      ['perros', 'perro'],
      ['gatos', 'gato'], // lemma 'gato' has no entry
    ]);
    const data = buildPack({ freqList, glossMap, meta, topN: 30000, skipTop: 0, lemmaMap });
    // perros resolves via lemma 'perro'
    expect(data.entries['perros']).toEqual({ r: 1, g: 'dog' });
    // gato has no gloss so gatos is dropped, and no inflection is emitted for it
    expect(data.entries['gatos']).toBeUndefined();
    // inflection emitted only because entries['perro'] would need to exist...
    // entries here keyed on surface form 'perros', lemma 'perro' is not an entry key,
    // so no inflection is emitted.
    expect(data.inflections).toEqual({});
  });

  it('drops the inflected form (mapping it to its lemma) when the lemma is an entry', () => {
    const freqList: FreqEntry[] = [
      { word: 'perro', rank: 1 },
      { word: 'perros', rank: 2 },
    ];
    const glossMap = new Map<string, string[]>([['perro', ['dog']]]);
    const lemmaMap = new Map<string, string>([['perros', 'perro']]);
    const data = buildPack({ freqList, glossMap, meta, topN: 30000, skipTop: 0, lemmaMap });
    expect(data.entries['perro']).toEqual({ r: 1, g: 'dog' });
    // The inflected form is NOT a standalone entry; it resolves to its lemma.
    expect(data.entries['perros']).toBeUndefined();
    expect(data.inflections['perros']).toBe('perro');
  });
});

describe('extractWikDict', () => {
  it('splits trans_list on |, lowercases the key, and keeps senses', () => {
    const m = extractWikDict([
      { written_rep: 'Rápido', trans_list: 'quick | fast | rapid' },
      { written_rep: 'casa', trans_list: 'house | home' },
    ]);
    expect(m.get('rápido')).toEqual(['quick', 'fast', 'rapid']);
    expect(m.get('casa')).toEqual(['house', 'home']);
  });

  it('merges + dedupes recurring headwords, capped at 6', () => {
    const m = extractWikDict([
      { written_rep: 'banco', trans_list: 'bank | bench' },
      { written_rep: 'banco', trans_list: 'bench | shoal | seat | stand | rail | desk' },
    ]);
    const senses = m.get('banco')!;
    expect(senses.slice(0, 3)).toEqual(['bank', 'bench', 'shoal']);
    expect(senses.length).toBe(6);
    expect(new Set(senses).size).toBe(6); // deduped
  });

  it('skips rows with empty trans_list or written_rep', () => {
    const m = extractWikDict([
      { written_rep: '', trans_list: 'x' },
      { written_rep: 'y', trans_list: '' },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('inflectionMapFromPack', () => {
  it('reads a pack JSON inflections map into a Map', () => {
    const m = inflectionMapFromPack(
      JSON.stringify({ entries: {}, inflections: { kept: 'keep', children: 'child' } }),
    );
    expect(m.get('kept')).toBe('keep');
    expect(m.get('children')).toBe('child');
    expect(m.size).toBe(2);
  });

  it('returns an empty Map on missing inflections or bad JSON', () => {
    expect(inflectionMapFromPack(JSON.stringify({ entries: {} })).size).toBe(0);
    expect(inflectionMapFromPack('not json').size).toBe(0);
  });
});

describe('parseLemmatizationList', () => {
  it('maps form -> lemma (col2 -> col1), strips a BOM, skips self-maps', () => {
    const m = parseLemmatizationList('﻿perro\tperros\nperro\tperra\ntener\ttuvo\ncasa\tcasa');
    expect(m.get('perros')).toBe('perro');
    expect(m.get('perra')).toBe('perro');
    expect(m.get('tuvo')).toBe('tener');
    expect(m.has('casa')).toBe(false); // form === lemma skipped
  });

  it('first-wins on an ambiguous form', () => {
    const m = parseLemmatizationList('a\tx\nb\tx');
    expect(m.get('x')).toBe('a');
  });
});
