// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  type AnkiImportNote,
  ankiHintOf,
  ankiLangOf,
  ankiDeckName,
  ankiLangTag,
  ankiWordOf,
  cleanAnkiField,
  defaultImportLang,
  ankiEntryGaps,
  ankiLayouts,
  ankiNoteFills,
  ankiNoteView,
  ankiNotesToSend,
  ankiProfileOf,
  ankiSyncNotes,
  ankiWordsToSend,
  ankiTagUpdates,
  ankiTtsLang,
  withNoteLangs,
  importLanguageOptions,
  planAnkiImport,
} from '@/services/vocabulary/anki';
import { ankiCardOf } from '@/services/vocabulary/export';
import type {
  AnkiProfile,
  AnkiProfileSettings,
  VocabularyEntry,
} from '@/services/vocabulary/types';

const entry = (key: string, patch: Partial<VocabularyEntry> = {}): VocabularyEntry => ({
  id: `${patch.lang ?? 'en'}:${key}`,
  lang: 'en',
  key,
  word: key,
  state: 'none',
  occurrences: [],
  createdAt: 1,
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

const note = (fields: string[], mature = false, tags = ''): AnkiImportNote => ({
  fields,
  tags,
  mature,
});

describe('cleanAnkiField', () => {
  it('splits block HTML into lines', () => {
    expect(
      cleanAnkiField(
        '<div style="font-size:1.6em">serendipity</div><div>A <b>serendipity</b> it was.</div>',
      ),
    ).toEqual(['serendipity', 'A serendipity it was.']);
  });

  it('drops sound tags and decodes entities', () => {
    expect(cleanAnkiField('caf&eacute;&nbsp;[sound:cafe.mp3]<br>x &amp; y')).toEqual([
      'café',
      'x & y',
    ]);
  });

  it('splits fields older Anki editors wrote with opening div tags', () => {
    expect(cleanAnkiField('spice<div>(noun)</div>')).toEqual(['spice', '(noun)']);
    expect(ankiWordOf(['spice<div>(noun)</div>'])).toBe('spice');
  });

  it('returns nothing for image-only fields', () => {
    expect(cleanAnkiField('<img src="a.jpg">')).toEqual([]);
  });
});

describe('ankiWordOf', () => {
  it('takes the cloze answer', () => {
    expect(ankiWordOf(['I felt {{c1::melancholy::sad}} today.'])).toBe('melancholy');
  });

  it('takes the first line of a Readest front', () => {
    expect(
      ankiWordOf([
        '<div style="font-size:1.6em">spice</div><div>The <b>spice</b> must flow.</div>',
      ]),
    ).toBe('spice');
  });

  it('rejects a sentence of more than 5 words', () => {
    expect(ankiWordOf(['the spice must flow on Arrakis'])).toBeNull();
  });

  it('rejects more than 40 chars', () => {
    expect(ankiWordOf(['a'.repeat(41)])).toBeNull();
  });

  it('rejects unspaced text over 12 chars', () => {
    expect(ankiWordOf(['今日はとても良い天気ですね'])).toBeNull();
  });

  it('accepts a short CJK word', () => {
    expect(ankiWordOf(['勉強'])).toBe('勉強');
  });

  it('rejects empty, image-only and sound-only', () => {
    expect(ankiWordOf([''])).toBeNull();
    expect(ankiWordOf(['<img src="a.jpg">'])).toBeNull();
    expect(ankiWordOf(['[sound:x.mp3]'])).toBeNull();
  });
});

describe('ankiHintOf', () => {
  it('takes the hint line above the book line', () => {
    expect(ankiHintOf(['x', 'a drug<br><small>Dune — Frank Herbert</small>'])).toBe('a drug');
  });

  it('cuts to 80 chars', () => {
    expect(ankiHintOf(['x', 'h'.repeat(100)])).toHaveLength(80);
  });

  it('is undefined with one field', () => {
    expect(ankiHintOf(['x'])).toBeUndefined();
  });

  it('never takes the book line of a Readest note as the hint', () => {
    expect(
      ankiHintOf(['x', '<small>Dune — Frank Herbert</small>'], 'readest Dune'),
    ).toBeUndefined();
    expect(ankiHintOf(['x', 'a drug<br><small>Dune — Frank Herbert</small>'], 'readest')).toBe(
      'a drug',
    );
  });
});

describe('language tag', () => {
  it('round-trips', () => {
    expect(ankiLangOf(`readest Dune ${ankiLangTag('fr')}`)).toBe('fr');
  });

  it('is undefined without one', () => {
    expect(ankiLangOf('readest Dune')).toBeUndefined();
  });
});

describe('planAnkiImport', () => {
  it('adds new words as Learning, or Mastered when mature', () => {
    const p = planAnkiImport([note(['spice', 'a drug']), note(['worm'], true)], {}, 'en');
    expect(p.ops).toEqual([
      { word: 'spice', lang: 'en', state: 'learning', hint: 'a drug' },
      { word: 'worm', lang: 'en', state: 'mastered', hint: undefined },
    ]);
    expect([p.added, p.mastered, p.skipped]).toEqual([2, 1, 0]);
  });

  it('leaves a Looked Up word Looked Up unless mature', () => {
    const p = planAnkiImport([note(['spice'])], { 'en:spice': entry('spice') }, 'en');
    expect(p.ops).toEqual([]);
  });

  it('raises an existing word to Mastered when mature, never lowers', () => {
    const entries = {
      'en:a': entry('a', { state: 'learning' }),
      'en:b': entry('b', { state: 'mastered' }),
    };
    const p = planAnkiImport([note(['a'], true), note(['b'], false)], entries, 'en');
    expect(p.ops).toEqual([{ word: 'a', lang: 'en', state: 'mastered' }]);
    expect(p.mastered).toBe(1);
  });

  it('fills a hint only when the word has none', () => {
    const entries = { 'en:a': entry('a', { hint: 'mine' }), 'en:b': entry('b') };
    const p = planAnkiImport([note(['a', 'theirs']), note(['b', 'theirs'])], entries, 'en');
    expect(p.ops).toEqual([{ word: 'b', lang: 'en', hint: 'theirs' }]);
  });

  it('skips words deleted in Readest', () => {
    const p = planAnkiImport([note(['a'])], { 'en:a': entry('a', { deletedAt: 5 }) }, 'en');
    expect([p.ops.length, p.skipped]).toEqual([0, 1]);
  });

  it('skips notes without a usable word', () => {
    const p = planAnkiImport([note(['<img src="a.jpg">']), note(['...'])], {}, 'en');
    expect([p.ops.length, p.skipped]).toEqual([0, 2]);
  });

  it('files a tagged note under its own language', () => {
    const p = planAnkiImport([note(['pain'], false, 'readest readest::lang::fr')], {}, 'en');
    expect(p.ops[0]!.lang).toBe('fr');
  });

  it('merges duplicate notes for one word', () => {
    const p = planAnkiImport([note(['a']), note(['A', 'first hint'], true)], {}, 'en');
    expect(p.ops).toEqual([{ word: 'a', lang: 'en', state: 'mastered', hint: 'first hint' }]);
    expect([p.added, p.mastered]).toEqual([1, 1]);
  });

  it('does not raise a word again for a card whose maturity it already applied', () => {
    const entries = { 'en:a': entry('a', { state: 'learning' }) };
    const p = planAnkiImport([note(['a'], true)], entries, 'en', new Set(['en:a']));
    expect([p.ops, p.mastered]).toEqual([[], 0]);
    expect(p.matured).toEqual(['en:a']);
  });

  it('lists the live words whose cards are mature, to remember for next time', () => {
    const entries = { 'en:b': entry('b'), 'en:gone': entry('gone', { deletedAt: 5 }) };
    const p = planAnkiImport(
      [note(['a'], true), note(['b'], true), note(['c']), note(['gone'], true)],
      entries,
      'en',
    );
    expect(p.matured).toEqual(['en:a', 'en:b']);
  });

  it('matches a word saved with odd spacing instead of adding it again', () => {
    const spaced = entry('ice\u00a0 cream', { state: 'learning' });
    const sent = ankiNotesToSend([{ ...spaced, occurrences: [{ sentence: 'x', at: 1 }] }], [])[0]!;
    const back = { fields: [...sent.fields], tags: sent.tags.join(' '), mature: true };
    const p = planAnkiImport([back], { [spaced.id]: spaced }, 'en');
    expect(p.ops).toEqual([{ word: 'ice\u00a0 cream', lang: 'en', state: 'mastered' }]);
    expect([p.added, p.matured]).toEqual([0, [spaced.id]]);
  });

  it('prefers a live word, then the exact spelling, when spacing makes several match', () => {
    const spaced = entry('ice\u00a0cream', { state: 'learning' });
    const exact = entry('ice cream', { state: 'learning' });
    const both = { [spaced.id]: spaced, [exact.id]: exact };
    expect(planAnkiImport([note(['ice cream'], true)], both, 'en').ops).toEqual([
      { word: 'ice cream', lang: 'en', state: 'mastered' },
    ]);
    const gone = { ...exact, deletedAt: 5 };
    const live = { [gone.id]: gone, [spaced.id]: spaced };
    expect(planAnkiImport([note(['ice cream'], true)], live, 'en').ops).toEqual([
      { word: 'ice\u00a0cream', lang: 'en', state: 'mastered' },
    ]);
  });

  it('plans 5,000 HTML notes in one pass', () => {
    const notes = Array.from({ length: 5000 }, (_, i) =>
      note([
        `<div style="font-size:1.6em">w${i}x</div><div>The <b>w${i}x</b> &amp; more.</div>`,
        `hint ${i}<br><small>Dune &mdash; Herbert</small>`,
      ]),
    );
    const started = performance.now();
    const plan = planAnkiImport(notes, {}, 'en');
    expect(plan.added).toBe(5000);
    expect(plan.ops[4999]).toEqual({
      word: 'w4999x',
      lang: 'en',
      state: 'learning',
      hint: 'hint 4999',
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('import languages', () => {
  it('defaults to the most common language, ignoring und', () => {
    expect(
      defaultImportLang({
        a: entry('a', { lang: 'fr' }),
        b: entry('b', { lang: 'und' }),
        c: entry('c', { lang: 'und' }),
      }),
    ).toBe('fr');
    expect(defaultImportLang({})).toBe('en');
  });

  it('ignores deleted words for the default', () => {
    expect(
      defaultImportLang({
        a: entry('a', { lang: 'fr', deletedAt: 1 }),
        b: entry('b', { lang: 'de' }),
      }),
    ).toBe('de');
  });

  it('offers base codes once, plus languages already in the list', () => {
    const codes = importLanguageOptions({ a: entry('a', { lang: 'la' }) }).map((o) => o.code);
    expect(codes).toContain('zh');
    expect(codes).toContain('pt');
    expect(codes).not.toContain('zh-CN');
    expect(codes).toContain('la');
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('ankiNotesToSend', () => {
  const spice = entry('spice', {
    state: 'learning',
    hint: 'a drug',
    occurrences: [{ sentence: 'The spice must flow.', at: 1, bookTitle: 'Dune' }],
  });

  it('builds the file export card plus language and mark tags', () => {
    const card = ankiCardOf(spice);
    expect(ankiNotesToSend([spice], [])).toEqual([
      {
        deck: 'Readest Vocabulary::English',
        fields: [card.front, card.back, 'spice', 'en_US', ''],
        tags: [...card.tags, 'readest::lang::en', 'readest::learning'],
      },
    ]);
  });

  it('gives the audio the word alone, as HTML, and no voice for an unknown language', () => {
    const [ampersand, unknown] = ankiNotesToSend(
      [entry('R&D', { lang: 'en' }), entry('x', { lang: 'und' })],
      [],
    );
    expect(ampersand!.fields.slice(2)).toEqual(['R&amp;D', 'en_US', '']);
    expect(unknown!.fields.slice(2)).toEqual(['x', '', '']);
  });

  it('files each word under its language subdeck, and unknown ones in the parent', () => {
    const decks = ankiNotesToSend(
      [entry('pain', { lang: 'fr' }), entry('hola', { lang: 'es' }), entry('x', { lang: 'und' })],
      [],
    ).map((n) => n.deck);
    expect(decks).toEqual([
      'Readest Vocabulary::French',
      'Readest Vocabulary::Spanish',
      'Readest Vocabulary',
    ]);
  });

  it('skips a word already in the deck under any note type', () => {
    expect(ankiNotesToSend([spice], [{ fields: ['Spice', 'x'], tags: '' }])).toEqual([]);
  });

  it('skips a word a Readest note already carries in the same language', () => {
    const sent = ankiNotesToSend([spice], [])[0]!;
    const existing = [{ fields: sent.fields, tags: sent.tags.join(' ') }];
    expect(ankiNotesToSend([spice], existing)).toEqual([]);
  });

  it('recognises a sent phrase longer than an imported word may be', () => {
    const phrase = entry('the spice must flow on arrakis', {
      word: 'the spice must flow on Arrakis',
    });
    const sent = ankiNotesToSend([phrase], [])[0]!;
    expect(ankiNotesToSend([phrase], [{ fields: sent.fields, tags: sent.tags.join(' ') }])).toEqual(
      [],
    );
  });

  it('recognises a sent word whose spacing the card normalizes', () => {
    const spaced = entry('ice  cream', { word: 'ice\u00a0 cream' });
    const sent = ankiNotesToSend([spaced], [])[0]!;
    expect(ankiNotesToSend([spaced], [{ fields: sent.fields, tags: sent.tags.join(' ') }])).toEqual(
      [],
    );
  });

  it('round-trips a word without a hint without inventing one', () => {
    const plain = entry('kettle', {
      occurrences: [
        { sentence: 'A kettle boiling.', at: 1, bookTitle: 'The Hobbit', bookAuthor: 'Tolkien' },
      ],
    });
    const sent = ankiNotesToSend([plain], [])[0]!;
    const back = { fields: [...sent.fields], tags: sent.tags.join(' '), mature: false };
    expect(planAnkiImport([back], { 'en:kettle': plain }, 'en').ops).toEqual([]);
    expect(planAnkiImport([back], {}, 'en').ops).toEqual([
      { word: 'kettle', lang: 'en', state: 'learning', hint: undefined },
    ]);
  });

  it('does not skip the same word in another language', () => {
    const fr = entry('pain', { lang: 'fr' });
    expect(ankiNotesToSend([fr], [{ fields: ['pain'], tags: 'readest::lang::en' }])).toHaveLength(
      1,
    );
  });

  it('never sends a deleted word', () => {
    expect(ankiNotesToSend([entry('gone', { deletedAt: 3 })], [])).toEqual([]);
  });
});

describe('dictionary entries on the card (#7728)', () => {
  const spice = entry('spice', {
    state: 'learning',
    occurrences: [{ sentence: 'The spice must flow.', at: 1 }],
  });

  it('puts a looked-up entry in the Entry field of the notes it sends', () => {
    expect(ankiWordsToSend([spice], [])).toEqual([spice]);
    const [note] = ankiNotesToSend([spice], [], { [spice.id]: '<p>a drug</p>' });
    expect(note!.fields[4]).toBe('<p>a drug</p>');
    expect(ankiNotesToSend([spice], [])[0]!.fields[4]).toBe('');
  });

  it("finds Readest's notes whose Entry is still empty, with their word and language", () => {
    const noteType = { id: 5, fields: ['Front', 'Back', 'Word', 'Language', 'Entry'] };
    const notes = [
      {
        id: 1,
        mid: 5,
        fields: ['<div>R&amp;D</div>', 'x', 'R&amp;D', 'en_US', ''],
        tags: 'readest::lang::en',
      },
      { id: 2, mid: 5, fields: ['done', 'x', 'done', 'en_US', '<p>kept</p>'], tags: '' },
      // Another note type in the deck.
      { id: 3, mid: 9, fields: ['other', 'x', '', '', ''], tags: '' },
      // Read before this Sync added the fields.
      { id: 4, mid: 5, fields: ['Haus', 'house'], tags: 'readest::lang::de' },
    ];
    expect(ankiEntryGaps(notes, ankiLayouts(undefined, [], noteType), 'en')).toEqual([
      { id: 1, field: 4, word: 'R&D', lang: 'en' },
      { id: 4, field: 4, word: 'Haus', lang: 'de' },
    ]);
  });

  it('starts after the last note a Sync tried, so notes with no entry never block the rest', () => {
    const noteType = { id: 5, fields: ['Front', 'Back', 'Word', 'Language', 'Entry'] };
    const note = (id: number) => ({
      id,
      mid: 5,
      fields: [`w${id}`, 'x', `w${id}`, 'en_US', ''],
      tags: '',
    });
    const notes = [note(30), note(10), note(20)];
    const layouts = ankiLayouts(undefined, [], noteType);
    const ids = (after?: number) => ankiEntryGaps(notes, layouts, 'en', after).map((g) => g.id);
    expect(ids()).toEqual([10, 20, 30]);
    expect(ids(10)).toEqual([20, 30, 10]);
    expect(ids(30)).toEqual([10, 20, 30]);
  });

  it('finds none when the note type has no Entry field', () => {
    const notes = [{ id: 1, mid: 5, fields: ['spice', 'x'], tags: '' }];
    const layouts = ankiLayouts(undefined, [], { id: 5, fields: ['Front', 'Back'] });
    expect(ankiEntryGaps(notes, layouts, 'en')).toEqual([]);
  });
});

describe('card profiles (#7849)', () => {
  const MINING = { id: 40, name: 'Mining', fields: ['Expression', 'Sentence', 'Meaning', 'Notes'] };
  const profiles = (patch: Partial<AnkiProfileSettings> = {}): AnkiProfileSettings => ({
    profiles: [
      {
        id: 'p1',
        name: 'German mining',
        deck: 'German::Reading',
        noteType: 'Mining',
        fields: { Expression: 'word', Sentence: 'sentence', Meaning: 'hint', Notes: 'link' },
        tags: ['from-readest'],
      },
      { id: 'p2', name: 'Plain', deck: 'Books', noteType: '', fields: {}, tags: ['novel'] },
    ],
    languages: { de: 'p1' },
    books: {},
    ...patch,
  });
  const haus = entry('haus', {
    lang: 'de',
    word: 'Haus',
    state: 'learning',
    hint: 'house',
    occurrences: [
      {
        sentence: 'Das Haus ist alt.',
        at: 1,
        bookHash: 'b1',
        bookTitle: 'Der Prozess',
        bookAuthor: 'Kafka',
        cfi: 'epubcfi(/6/4!/4/2)',
      },
    ],
  });

  it("uses the latest book's profile over the language's, and none without either", () => {
    expect(ankiProfileOf(haus, profiles())?.id).toBe('p1');
    expect(ankiProfileOf(haus, profiles({ books: { b1: 'p2' } }))?.id).toBe('p2');
    expect(ankiProfileOf(entry('spice', {}), profiles())).toBeUndefined();
    expect(ankiProfileOf(haus, undefined)).toBeUndefined();
    // A profile deleted on another device leaves the word on Readest's own cards.
    expect(ankiProfileOf(haus, profiles({ languages: { de: 'gone' } }))).toBeUndefined();
  });

  it("fills the profile's note type field by field, in its deck, with its tags", () => {
    const [note] = ankiNotesToSend([haus], [], {}, profiles(), [MINING]);
    expect(note).toEqual({
      deck: 'German::Reading',
      modelId: 40,
      fields: [
        'Haus',
        'Das <b>Haus</b> ist alt.',
        'house',
        '<a href="readest://book/b1?cfi=epubcfi(%2F6%2F4!%2F4%2F2)">Der Prozess</a>',
      ],
      tags: ['readest', 'Der_Prozess', 'readest::lang::de', 'readest::learning', 'from-readest'],
    });
  });

  it('can put the dictionary entry, the audio, the book and the author in any field', () => {
    const settings = profiles();
    settings.profiles[0]!.fields = {
      Expression: 'word',
      Sentence: 'audio',
      Meaning: 'entry',
      Notes: 'author',
    };
    const [note] = ankiNotesToSend([haus], [], { [haus.id]: '<p>das Haus</p>' }, settings, [
      MINING,
    ]);
    expect(note!.fields).toEqual([
      'Haus',
      '[anki:tts lang=de_DE]Haus[/anki:tts]',
      '<p>das Haus</p>',
      'Kafka',
    ]);
    settings.profiles[0]!.fields = { Expression: 'word', Notes: 'book' };
    expect(ankiNotesToSend([haus], [], {}, settings, [MINING])[0]!.fields).toEqual([
      'Haus',
      '',
      '',
      'Der Prozess',
    ]);
    // The language as the CSV export writes it: its code.
    settings.profiles[0]!.fields = { Expression: 'word', Notes: 'language' };
    expect(ankiNotesToSend([haus], [], {}, settings, [MINING])[0]!.fields[3]).toBe('de');
  });

  it("keeps Readest's own note type for a profile without one, in the profile's deck", () => {
    const card = ankiCardOf(haus);
    expect(ankiNotesToSend([haus], [], {}, profiles({ languages: { de: 'p2' } }), [])).toEqual([
      {
        deck: 'Books',
        fields: [card.front, card.back, 'Haus', 'de_DE', ''],
        tags: [...card.tags, 'readest::lang::de', 'readest::learning', 'novel'],
      },
    ]);
  });

  it('files a word under its language subdeck when the profile names no deck', () => {
    const settings = profiles();
    settings.profiles[0]!.deck = '';
    expect(ankiNotesToSend([haus], [], {}, settings, [MINING])[0]!.deck).toBe(
      'Readest Vocabulary::German',
    );
  });

  it("holds a word back while its profile's note type isn't in the collection", () => {
    expect(ankiNotesToSend([haus], [], {}, profiles(), [])).toEqual([]);
  });

  it("holds a word back while its profile's Word field is gone from the note type", () => {
    // Expression was renamed: a note without its word would be sent again on every Sync.
    const renamed = { ...MINING, fields: ['Term', 'Sentence', 'Meaning', 'Notes'] };
    expect(ankiNotesToSend([haus], [], {}, profiles(), [renamed])).toEqual([]);
  });

  it("reads a profile note's word and hint from the fields its profile maps", () => {
    const layouts = ankiLayouts(profiles(), [MINING]);
    const note = { id: 1, mid: 40, fields: ['Haus', 'Das Haus.', 'house', ''], tags: 'readest' };
    expect(ankiNoteView(note, layouts).fields).toEqual(['Haus', 'house']);
    // Other note types read as before: word first, hint second.
    const other = { id: 2, mid: 9, fields: ['spice', 'a drug'], tags: '' };
    expect(ankiNoteView(other, layouts)).toBe(other);
  });

  it('reads a note type through a profile whose Word field it still has', () => {
    const settings = profiles();
    const repaired: AnkiProfile = {
      ...settings.profiles[0]!,
      id: 'p3',
      fields: { Term: 'word', Meaning: 'hint' },
    };
    settings.profiles.push(repaired);
    // Expression was renamed to Term: p1 still names the old field.
    const renamed = { ...MINING, fields: ['Term', 'Sentence', 'Meaning', 'Notes'] };
    expect(ankiLayouts(settings, [renamed]).get(40)).toEqual({ word: 0, hint: 2, entry: -1 });
  });

  it('takes each read field from the first profile that still has it', () => {
    const settings = profiles();
    settings.profiles[0]!.fields = { Expression: 'word', Meaning: 'hint', Notes: 'entry' };
    // Meaning and Notes were renamed; only the second profile was repaired.
    settings.profiles.push({
      ...settings.profiles[0]!,
      id: 'p3',
      fields: { Expression: 'word', Gloss: 'hint', Extra: 'entry' },
    });
    const renamed = { ...MINING, fields: ['Expression', 'Sentence', 'Gloss', 'Extra'] };
    expect(ankiLayouts(settings, [renamed]).get(40)).toEqual({ word: 0, hint: 2, entry: 3 });
  });

  it("keeps the reader's own notes of a profile's note type out even with its Word field gone", () => {
    // Expression was renamed and no profile maps the new field yet.
    const renamed = { ...MINING, fields: ['Term', 'Sentence', 'Meaning', 'Notes'] };
    const layouts = ankiLayouts(profiles(), [renamed]);
    const own = [{ id: 3, mid: 40, fields: ['Baum', '', 'tree', ''], tags: 'mine' }];
    const { notes, known } = ankiSyncNotes(own, [], layouts);
    expect(notes).toEqual([]);
    expect(known.map((n) => n.id)).toEqual([3]);
  });

  it("works with every note of Readest's decks but only Readest's notes in a profile's deck", () => {
    const layouts = ankiLayouts(profiles(), [MINING]);
    const own = [{ id: 1, mid: 9, fields: ['kettle'], tags: '' }];
    const other = [
      { id: 1, mid: 9, fields: ['kettle'], tags: '' },
      { id: 2, mid: 40, fields: ['Haus', '', 'house', ''], tags: 'readest readest::lang::de' },
      // The reader's own cards: they only keep Sync from adding the word again.
      { id: 3, mid: 40, fields: ['Baum', '', 'tree', ''], tags: 'mine' },
      { id: 4, mid: 77, fields: ['Kanji'], tags: '' },
    ];
    const { notes, known } = ankiSyncNotes(own, other, layouts);
    expect(notes.map((n) => n.id)).toEqual([1, 2]);
    expect(known.map((n) => n.id)).toEqual([3]);
    const baum = entry('baum', { lang: 'de', word: 'Baum', state: 'learning' });
    const view = known.map((n) => ankiNoteView(n, layouts));
    expect(ankiNotesToSend([baum], view, {}, profiles(), [MINING])).toEqual([]);
  });

  it("takes only Readest's notes of a profile's note type in Readest's own decks too", () => {
    const layouts = ankiLayouts(profiles(), [MINING]);
    const own = [
      // Another note type in Readest's decks: everything there is Readest's, as before.
      { id: 1, mid: 9, fields: ['kettle'], tags: '' },
      { id: 2, mid: 40, fields: ['Haus', '', 'house', ''], tags: 'readest readest::lang::de' },
      // A profile that sends to a deck under Readest Vocabulary meets the reader's own cards.
      { id: 3, mid: 40, fields: ['Baum', '', 'tree', ''], tags: 'mine' },
    ];
    const { notes, known } = ankiSyncNotes(own, [], layouts);
    expect(notes.map((n) => n.id)).toEqual([1, 2]);
    expect(known.map((n) => n.id)).toEqual([3]);
  });

  it("finds the empty Entry field a profile maps on Readest's notes", () => {
    const settings = profiles();
    settings.profiles[0]!.fields = { Expression: 'word', Notes: 'entry' };
    const layouts = ankiLayouts(settings, [MINING]);
    const notes = [
      { id: 1, mid: 40, fields: ['Haus', '', '', ''], tags: 'readest readest::lang::de' },
      { id: 2, mid: 40, fields: ['Baum', '', '', '<p>kept</p>'], tags: 'readest' },
    ];
    expect(ankiEntryGaps(notes, layouts, 'en')).toEqual([
      { id: 1, field: 3, word: 'Haus', lang: 'de' },
    ]);
  });
});

describe('ankiTtsLang', () => {
  it("names the locale Anki's TTS needs: a bare language code finds no voice", () => {
    expect(['en', 'de', 'pt', 'zh', 'ja'].map(ankiTtsLang)).toEqual([
      'en_US',
      'de_DE',
      'pt_BR',
      'zh_CN',
      'ja_JP',
    ]);
  });

  it('gives no voice for an unknown language', () => {
    expect(ankiTtsLang('und')).toBe('');
  });
});

describe('ankiNoteFills', () => {
  it("fills a note's Word and Language from its first field and language tag", () => {
    const front = '<div style="font-size:1.6em">R&amp;D</div><div>Our <b>R&amp;D</b> team.</div>';
    expect(
      ankiNoteFills([{ id: 7, fields: [front, 'hint'], tags: 'readest readest::lang::en' }]),
    ).toEqual([{ id: 7, word: 'R&amp;D', language: 'en_US' }]);
  });

  it('leaves out notes with no word', () => {
    expect(ankiNoteFills([{ id: 7, fields: ['<img src="a.png">'], tags: '' }])).toEqual([]);
  });
});

describe('ankiDeckName', () => {
  it('names the subdeck in English, whatever the UI language, with one name per language', () => {
    expect(ankiDeckName('en')).toBe('Readest Vocabulary::English');
    expect(ankiDeckName('el')).toBe('Readest Vocabulary::Greek');
    expect(ankiDeckName('nl')).toBe('Readest Vocabulary::Dutch');
    expect(ankiDeckName('ro')).toBe('Readest Vocabulary::Romanian');
    expect(ankiDeckName('zh')).toBe('Readest Vocabulary::Chinese');
  });

  it('keeps words of unknown language in the parent deck', () => {
    expect(ankiDeckName('und')).toBe('Readest Vocabulary');
  });
});

describe('ankiTagUpdates', () => {
  const words = (...list: VocabularyEntry[]) => Object.fromEntries(list.map((e) => [e.id, e]));
  const row = (id: number, word: string, tags: string) => ({ id, fields: [word], tags });

  it("tags a Learning word's note, keeping its other tags", () => {
    expect(
      ankiTagUpdates(
        [row(1, 'spice', ' readest Dune ')],
        words(entry('spice', { state: 'learning' })),
        'en',
      ),
    ).toEqual([{ id: 1, tags: ['readest', 'Dune', 'readest::learning'] }]);
  });

  it('replaces learning with mastered', () => {
    expect(
      ankiTagUpdates(
        [row(1, 'spice', 'readest readest::learning')],
        words(entry('spice', { state: 'mastered' })),
        'en',
      ),
    ).toEqual([{ id: 1, tags: ['readest', 'readest::mastered'] }]);
  });

  it("removes the mark from a Looked Up word's note", () => {
    expect(
      ankiTagUpdates([row(1, 'spice', 'x readest::mastered')], words(entry('spice')), 'en'),
    ).toEqual([{ id: 1, tags: ['x'] }]);
  });

  it('leaves a note alone when its mark already matches, in any case', () => {
    const spice = words(entry('spice', { state: 'learning' }));
    expect(ankiTagUpdates([row(1, 'spice', 'Readest::Learning')], spice, 'en')).toEqual([]);
    expect(ankiTagUpdates([row(2, 'sandworm', 'x')], words(entry('sandworm')), 'en')).toEqual([]);
  });

  it('leaves notes without a live word alone', () => {
    const gone = words(entry('gone', { state: 'learning', deletedAt: 3 }));
    expect(ankiTagUpdates([row(1, 'gone', ''), row(2, 'unknown', '')], gone, 'en')).toEqual([]);
  });

  it('tags the note of a word saved with odd spacing', () => {
    const spaced = entry('ice\u00a0 cream', { state: 'mastered' });
    expect(ankiTagUpdates([row(1, 'ice cream', 'readest::learning')], words(spaced), 'en')).toEqual(
      [{ id: 1, tags: ['readest::mastered'] }],
    );
  });

  it('files a note by its language tag, else the given language', () => {
    const list = words(
      entry('pain', { lang: 'fr', state: 'learning' }),
      entry('brot', { lang: 'de', state: 'mastered' }),
    );
    expect(
      ankiTagUpdates([row(1, 'pain', 'readest::lang::fr'), row(2, 'Brot', '')], list, 'de'),
    ).toEqual([
      { id: 1, tags: ['readest::lang::fr', 'readest::learning'] },
      { id: 2, tags: ['readest::mastered'] },
    ]);
  });
});

describe('withNoteLangs', () => {
  const words = (...list: VocabularyEntry[]) => Object.fromEntries(list.map((e) => [e.id, e]));
  const row = (word: string, tags = '') => ({ id: 1, fields: [word], tags });
  const langOf = (n: { tags: string }) => ankiLangOf(n.tags);

  it("keeps a note's own language", () => {
    expect(withNoteLangs([row('pain', 'x readest::lang::fr')], {}, 'en')[0]!.tags).toBe(
      'x readest::lang::fr',
    );
  });

  it('files an untagged note under the word Readest has with its key, in any language', () => {
    const list = words(entry('pain', { lang: 'fr' }));
    expect(langOf(withNoteLangs([row('Pain', 'mine')], list, 'en')[0]!)).toBe('fr');
  });

  it('prefers the given language when the word is in several', () => {
    const list = words(entry('pain', { lang: 'fr' }), entry('pain', { lang: 'en' }));
    expect(langOf(withNoteLangs([row('pain')], list, 'en')[0]!)).toBe('en');
  });

  it('prefers a live word over a deleted one, and a deleted one over none', () => {
    const live = words(entry('pain', { lang: 'en', deletedAt: 3 }), entry('pain', { lang: 'fr' }));
    expect(langOf(withNoteLangs([row('pain')], live, 'en')[0]!)).toBe('fr');
    const gone = words(entry('pain', { lang: 'fr', deletedAt: 3 }));
    expect(langOf(withNoteLangs([row('pain')], gone, 'en')[0]!)).toBe('fr');
  });

  it('files an untagged note under a word saved with odd spacing', () => {
    const list = words(entry('ice\u00a0 cream', { id: 'fr:ice\u00a0 cream', lang: 'fr' }));
    expect(langOf(withNoteLangs([row('ice cream')], list, 'en')[0]!)).toBe('fr');
  });

  it('prefers the exact spelling when spacing makes several match', () => {
    const list = words(
      entry('ice\u00a0cream', { id: 'fr:ice\u00a0cream', lang: 'fr' }),
      entry('ice cream', { id: 'de:ice cream', lang: 'de' }),
    );
    expect(langOf(withNoteLangs([row('ice cream')], list, 'en')[0]!)).toBe('de');
  });

  it('falls back to the given language', () => {
    expect(withNoteLangs([row('pain', ' mine ')], {}, 'de')[0]!.tags).toBe(
      'mine readest::lang::de',
    );
  });
});
