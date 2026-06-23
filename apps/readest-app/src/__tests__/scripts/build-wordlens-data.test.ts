import { describe, it, expect } from 'vitest';
// Import the real exported helpers from the .mjs build script (vitest/vite can
// import ESM .mjs directly), so the test exercises the actual logic.
import {
  parseCsvLine,
  parseExchange,
  shortGloss,
  shortDefGloss,
  finalizeInflections as finalizeInflectionsUntyped,
  parseWordNetData as parseWordNetDataUntyped,
  parseWordNetIndex as parseWordNetIndexUntyped,
  resolveEnEnGloss as resolveEnEnGlossUntyped,
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

type WnSynset = { members: string[]; hyper: string | null };
type WnPrimary = {
  noun: Map<string, string>;
  verb: Map<string, string>;
  adj: Map<string, string>;
  adv: Map<string, string>;
};
interface WordNet {
  byKey: Map<string, WnSynset>;
  primary: WnPrimary;
}
const emptyWordNet = (): WordNet => ({
  byKey: new Map(),
  primary: { noun: new Map(), verb: new Map(), adj: new Map(), adv: new Map() },
});
const buildEnEn = buildEnEnUntyped as (
  csvText: string,
  wordnet: WordNet,
  topN: number,
) => GlossIndexData;
const finalizeInflections = finalizeInflectionsUntyped as (
  entries: Record<string, { r: number; g: string }>,
  inflections: Record<string, string>,
) => void;
const parseWordNetData = parseWordNetDataUntyped as (
  text: string,
  pos: string,
  byKey?: Map<string, WnSynset>,
) => Map<string, WnSynset>;
const parseWordNetIndex = parseWordNetIndexUntyped as (
  text: string,
  map?: Map<string, string>,
) => Map<string, string>;
const resolveEnEnGloss = resolveEnEnGlossUntyped as (
  word: string,
  rawDef: string,
  ctx: { byKey: Map<string, WnSynset>; primary: WnPrimary; frqMap: Map<string, number> },
) => string;
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
  it('keeps the first 1-2 senses joined by ；', () => {
    const g = shortGloss('to run; to operate; to manage; foo');
    expect(g).toBe('to run；to operate');
  });

  it('does not length-cap a long sense (the cap is applied at display, not in the pack)', () => {
    const g = shortGloss('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(g).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); // 32 chars stored as-is
  });

  it('strips leading POS tags, bracket annotations, and CL: clauses', () => {
    expect(shortGloss('a. 神秘的')).toBe('神秘的');
    expect(shortGloss('vt. 做；vi. 看')).toBe('做；看');
    expect(shortGloss('[网络] 隐；晦涩的')).toBe('隐；晦涩的');
    expect(shortGloss('government/CL:個|个[ge4]')).toBe('government');
  });

  it('keeps only the first synonym within each sense (","/"、"-separated)', () => {
    // ";" separates senses; "," within a sense separates near-synonyms → keep first.
    expect(shortGloss('阻止, 监禁, 拘留；隔离, 拘留, 滞留, 停')).toBe('阻止；隔离');
    expect(shortGloss('house, home')).toBe('house');
  });

  it('dedupes when two senses share the same first synonym', () => {
    expect(shortGloss('天的, 天国的, 天空的；天的, 天空的, 天国')).toBe('天的');
  });
});

describe('shortDefGloss', () => {
  it('shows at most two senses when there is no ";" (\\n-separated)', () => {
    // ECDICT separates sense lines with a literal "\n" (backslash-n).
    const def = String.raw`to begin\nto start\nto set in motion`;
    expect(shortDefGloss(def)).toBe('to begin; to start');
  });

  it('treats each ";" part as a sense and keeps at most two of them', () => {
    expect(shortDefGloss('quick; fast')).toBe('quick; fast');
    expect(shortDefGloss('a; b; c; d; e')).toBe('a; b'); // at most two ";" parts
    // a ";" within a line is a sense even when the line came from a \n split.
    expect(shortDefGloss(String.raw`of an obscure nature; puzzling\nhidden`)).toBe(
      'of an obscure nature; puzzling',
    );
  });

  it('stores the full ≤2-sense definition without length-capping (the cap is applied at display)', () => {
    expect(shortDefGloss('enjoying or showing or marked by joy or pleasure')).toBe(
      'enjoying or showing or marked by joy or pleasure',
    );
  });

  it('strips POS codes — period-terminated (n./adv.) or bare WordNet (v/s)', () => {
    expect(shortDefGloss('v take the first step')).toBe('take the first step');
    expect(shortDefGloss('s being present')).toBe('being present');
    expect(shortDefGloss('adv. in a quick way')).toBe('in a quick way');
    // a bare leading "a" is the article, not the adjective POS code → kept.
    expect(shortDefGloss('n. a small house')).toBe('a small house');
  });

  it('strips bracket annotations and a Webster-style trailing period', () => {
    expect(shortDefGloss('a happy state [psychology]')).toBe('a happy state');
    expect(shortDefGloss('A magician.')).toBe('A magician');
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

  it('falls back to the full ECDICT definition (≤2 senses) when no WordNet hint applies', () => {
    const data = buildEnEn(csv, emptyWordNet(), 100);
    expect(data.meta).toEqual({
      source: 'en',
      target: 'en',
      metric: 'frq',
      version: 1,
      count: 2,
    });
    expect(data.entries['run']).toEqual({ r: 312, g: 'move fast on foot' });
    // stored uncapped; the display-time cap (cleanGloss) shortens it when rendered.
    expect(data.entries['cryptic']).toEqual({ r: 18000, g: 'having a hidden meaning; mysterious' });
    // exchange forms map back to the lemma; the lemma itself is not an inflection.
    expect(data.inflections['ran']).toBe('run');
    expect(data.inflections['runs']).toBe('run');
    expect(data.inflections['run']).toBeUndefined();
  });

  it('prefers a simpler synonym / category from WordNet over the definition', () => {
    const csv2 = [
      header,
      'ship,/ʃ/,a large seagoing vessel,船,n,,,,100,4000,,,',
      'vessel,/v/,a craft for traveling on water,船,n,,,,100,2500,,,',
      'prejudice,/p/,an adverse judgment formed beforehand,偏见,n,,,,100,6000,,,',
      'bias,/b/,a partiality,偏向,n,,,,100,3000,,,',
    ].join('\n');
    const wn = emptyWordNet();
    wn.byKey.set('noun:1', { members: ['ship'], hyper: 'noun:2' });
    wn.byKey.set('noun:2', { members: ['vessel'], hyper: null });
    wn.byKey.set('noun:3', { members: ['prejudice', 'bias'], hyper: null });
    wn.primary.noun.set('ship', '1');
    wn.primary.noun.set('prejudice', '3');
    const data = buildEnEn(csv2, wn, 100);
    expect(data.entries['ship']!.g).toBe('vessel'); // no simpler synonym → hypernym
    expect(data.entries['prejudice']!.g).toBe('bias'); // simpler synonym wins
  });

  it('skips a row whose definition is empty', () => {
    const data = buildEnEn([header, 'word,/x/,,无,n,1,,,1,10,,,'].join('\n'), emptyWordNet(), 100);
    expect(data.entries['word']).toBeUndefined();
    expect(data.meta.count).toBe(0);
  });

  it('drops an inflected-form entry when its lemma is present (lemmatize)', () => {
    const csv2 = [
      header,
      'keep,/kiːp/,hold on to,保持,v,5,,,50,120,p:kept/i:keeping/3:keeps,,',
      'kept,/kept/,past tense of keep,过去式,v,,,,800,2500,,,',
    ].join('\n');
    const data = buildEnEn(csv2, emptyWordNet(), 100);
    expect(data.entries['kept']).toBeUndefined();
    expect(data.entries['keep']).toEqual({ r: 120, g: 'hold on to' });
    expect(data.inflections['kept']).toBe('keep');
    expect(data.meta.count).toBe(1);
  });

  it('lemmatizes a transparent derivation to its base when the definition names it (thickly ⇐ thick)', () => {
    const csv2 = [
      header,
      'thick,/θ/,of great width,厚的,adj,,,,100,1000,,,',
      'thickly,/θ/,in a thick manner,浓密地,adv,,,,500,15000,,,',
    ].join('\n');
    const data = buildEnEn(csv2, emptyWordNet(), 100);
    // "thickly" resolves to "thick" (so the difficulty check uses thick's rank).
    expect(data.entries['thickly']).toBeUndefined();
    expect(data.inflections['thickly']).toBe('thick');
    expect(data.entries['thick']).toEqual({ r: 1000, g: 'of great width' });
  });

  it('lemmatizes a negative -able derivation via translation overlap (insufferable ⇐ suffer)', () => {
    // The English def never names "suffer", so def-mention alone can't validate it;
    // the Chinese translations overlap (忍受) → transparent derivation.
    const csv2 = [
      header,
      'suffer,/s/,undergo pain,"遭受, 经历, 忍受",v,,,,100,1099,d:suffered/p:suffered/i:suffering/3:suffers,,',
      'insufferable,/i/,used of persons or their behavior,"不可忍受的, 忍耐不住的",adj,,,,500,24043,,,',
    ].join('\n');
    const data = buildEnEn(csv2, emptyWordNet(), 100);
    expect(data.entries['insufferable']).toBeUndefined();
    expect(data.inflections['insufferable']).toBe('suffer');
    expect(data.entries['suffer']).toBeDefined();
  });

  it('keeps an -able word whose stem is a coincidence (capable ⇏ cap)', () => {
    // morphologically capable→cap, but the translations share nothing → not a derivation.
    const csv2 = [
      header,
      'cap,/k/,a head covering,"帽子, 盖",n,,,,100,2000,,,',
      'capable,/k/,having the ability,"有能力的, 能干的",adj,,,,500,9000,,,',
    ].join('\n');
    const data = buildEnEn(csv2, emptyWordNet(), 100);
    expect(data.inflections['capable']).toBeUndefined();
    expect(data.entries['capable']).toBeDefined();
  });

  it('keeps a drifted derivation (hardly⇐hard) and a false base match (ally⇐ale)', () => {
    const csv2 = [
      header,
      'hard,/h/,not easy,坚硬的,adj,,,,100,500,,,',
      'hardly,/h/,almost not,几乎不,adv,,,,500,16000,,,',
      'ale,/eɪl/,a kind of beer,啤酒,n,,,,100,3000,,,',
      'ally,/ə/,a friendly nation,盟友,n,,,,500,8000,,,',
    ].join('\n');
    const data = buildEnEn(csv2, emptyWordNet(), 100);
    // definition doesn't name the base → not a transparent derivation, kept as-is.
    expect(data.inflections['hardly']).toBeUndefined();
    expect(data.entries['hardly']).toBeDefined();
    expect(data.inflections['ally']).toBeUndefined();
    expect(data.entries['ally']).toBeDefined();
  });
});

describe('WordNet hybrid (parse + resolve)', () => {
  it('parseWordNetData: members + first hypernym pointer, keyed pos:offset', () => {
    const line = '01382086 00 s 02 huge 0 immense 0 002 @ 01382033 a 0000 & 0 a 0000 | great';
    const byKey = parseWordNetData(line, 'adj');
    expect(byKey.get('adj:01382086')).toEqual({
      members: ['huge', 'immense'],
      hyper: 'adj:01382033',
    });
  });

  it('parseWordNetIndex: lemma → primary (first) synset offset', () => {
    const idx = ['huge a 2 1 & 2 0 01382086 09573200', 'enormous a 1 1 & 1 0 00109510'].join('\n');
    const m = parseWordNetIndex(idx);
    expect(m.get('huge')).toBe('01382086'); // first/primary offset, secondary dropped
    expect(m.get('enormous')).toBe('00109510');
  });

  it('resolveEnEnGloss: synonym → hypernym → definition (POS-priority)', () => {
    const byKey = new Map<string, WnSynset>([
      ['noun:1', { members: ['ship'], hyper: 'noun:2' }],
      ['noun:2', { members: ['vessel'], hyper: null }],
      ['noun:3', { members: ['prejudice', 'bias'], hyper: null }],
      ['noun:4', { members: ['thing'], hyper: 'noun:5' }],
      ['noun:5', { members: ['entity'], hyper: null }], // generic hypernym
    ]);
    const primary: WnPrimary = {
      noun: new Map([
        ['ship', '1'],
        ['prejudice', '3'],
        ['thing', '4'],
      ]),
      verb: new Map(),
      adj: new Map(),
      adv: new Map(),
    };
    const frqMap = new Map<string, number>([
      ['ship', 4000],
      ['vessel', 2500],
      ['prejudice', 6000],
      ['bias', 3000],
      ['thing', 50],
    ]);
    const ctx = { byKey, primary, frqMap };
    expect(resolveEnEnGloss('prejudice', 'an adverse judgment', ctx)).toBe('bias'); // simpler synonym
    expect(resolveEnEnGloss('ship', 'a large vessel', ctx)).toBe('vessel'); // hypernym (no synonym)
    expect(resolveEnEnGloss('thing', 'a generic item', ctx)).toBe('a generic item'); // generic hyper → def
    expect(resolveEnEnGloss('zzz', 'made up word', ctx)).toBe('made up word'); // no WordNet entry → def
  });
});

describe('finalizeInflections', () => {
  it('resolves an inflection chain to the terminal lemma (paintings→painting→paint)', () => {
    const entries: Record<string, { r: number; g: string }> = {
      paint: { r: 500, g: 'x' },
      painting: { r: 800, g: 'y' },
      paintings: { r: 1200, g: 'z' },
    };
    const inflections: Record<string, string> = { painting: 'paint', paintings: 'painting' };
    finalizeInflections(entries, inflections);
    expect(inflections['paintings']).toBe('paint'); // chain resolved to terminal
    expect(inflections['painting']).toBe('paint');
    expect(entries['painting']).toBeUndefined(); // both dropped (paint is more common)
    expect(entries['paintings']).toBeUndefined();
    expect(entries['paint']).toBeDefined();
  });

  it('prunes a wrong collision where the form outranks its lemma (number⇏numb)', () => {
    const entries: Record<string, { r: number; g: string }> = {
      number: { r: 300, g: 'a count' },
      numb: { r: 9000, g: 'without feeling' },
      numbers: { r: 1500, g: 'counts' },
    };
    const inflections: Record<string, string> = { number: 'numb', numbers: 'number' };
    finalizeInflections(entries, inflections);
    expect(inflections['number']).toBeUndefined(); // wrong link pruned
    expect(entries['number']).toBeDefined(); // the common noun is kept as an entry
    expect(inflections['numbers']).toBe('number'); // valid inflection of the kept entry
    expect(entries['numbers']).toBeUndefined();
  });

  it('drops a mapping whose terminal lemma is not an entry (no dangling)', () => {
    const entries: Record<string, { r: number; g: string }> = { run: { r: 100, g: 'go fast' } };
    const inflections: Record<string, string> = { jogging: 'jog' }; // jog is not an entry
    finalizeInflections(entries, inflections);
    expect(inflections['jogging']).toBeUndefined();
  });

  it('breaks an inflection cycle instead of self-looping (axes↔axis)', () => {
    const entries: Record<string, { r: number; g: string }> = {
      axis: { r: 4000, g: 'a line' },
      axes: { r: 5000, g: 'plural' },
    };
    const inflections: Record<string, string> = { axes: 'axis', axis: 'axes' }; // mutual
    finalizeInflections(entries, inflections);
    // No self-loop, no dangling: every surviving inflection points at a present entry.
    for (const [form, lemma] of Object.entries(inflections)) {
      expect(form).not.toBe(lemma);
      expect(entries[lemma]).toBeDefined();
    }
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

  it('lemmatizes a derivation via the English definition column even though the gloss is Chinese', () => {
    const csv2 = [
      header,
      'thick,/θ/,of great width,厚的,adj,,,,100,1000,,,',
      'thickly,/θ/,in a thick manner,浓密地,adv,,,,500,15000,,,',
    ].join('\n');
    const data = buildEnZh(csv2, 100);
    expect(data.entries['thickly']).toBeUndefined();
    expect(data.inflections['thickly']).toBe('thick');
    expect(data.entries['thick']).toEqual({ r: 1000, g: '厚的' }); // gloss still from translation
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

  it('lemmatizes an English DERIVATION in an en-X pack via the reused en-zh table (thickly⇐thick)', () => {
    // en-X (e.g. en-de) builds pass the en-zh inflection table as lemmaMap, which now
    // carries derivations (thickly→thick) — so the rule holds for every en-source pair.
    const freqList: FreqEntry[] = [
      { word: 'thick', rank: 1 },
      { word: 'thickly', rank: 2 },
    ];
    const glossMap = new Map<string, string[]>([['thick', ['breit']]]); // en→de gloss
    const lemmaMap = new Map<string, string>([['thickly', 'thick']]); // from en-zh.json
    const data = buildPack({ freqList, glossMap, meta, topN: 30000, skipTop: 0, lemmaMap });
    expect(data.entries['thickly']).toBeUndefined();
    expect(data.inflections['thickly']).toBe('thick');
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
