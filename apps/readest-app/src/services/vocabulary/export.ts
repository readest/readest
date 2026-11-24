import { toDateKey } from '@/services/statistics/readingStats';
import type { VocabularyEntry } from './types';

// Vocabulary export (#789): an Anki text-import file (the header lines make it
// import without field mapping) and a CSV for spreadsheets / other apps.

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const oneLine = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scripts written without spaces have no word boundaries to respect.
export const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Bold `word` inside an already-escaped sentence. */
const boldWord = (sentence: string, word: string): string => {
  const w = escapeRegExp(escapeHtml(word));
  if (UNSPACED.test(word)) return sentence.replace(new RegExp(w, 'giu'), (m) => `<b>${m}</b>`);
  // No lookbehind (WebKit < 16.4 rejects it): consume the boundary before the word.
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${w})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
  return sentence.replace(re, (_m, pre: string, hit: string) => `${pre}<b>${hit}</b>`);
};

const latest = (e: VocabularyEntry) => e.occurrences[0];

const bookTag = (title?: string) => (title ? title.trim().replace(/\s+/g, '_') : '');

/**
 * A word's pieces as card HTML, from its latest sentence: the sentence with the
 * word in bold. Also what a card profile's fields are filled with (#7849).
 */
export const ankiPartsOf = (e: VocabularyEntry) => {
  const occ = latest(e);
  return {
    word: escapeHtml(oneLine(e.word)),
    sentence: occ ? boldWord(escapeHtml(oneLine(occ.sentence)), oneLine(e.word)) : '',
    hint: escapeHtml(oneLine(e.hint ?? '')),
    book: escapeHtml(oneLine(occ?.bookTitle ?? '')),
    author: escapeHtml(oneLine(occ?.bookAuthor ?? '')),
  };
};

/** The card a word becomes in Anki, for the file export and the AnkiDroid link. */
export const ankiCardOf = (
  e: VocabularyEntry,
): { word: string; front: string; back: string; tags: string[] } => {
  const occ = latest(e);
  const { word, sentence, hint } = ankiPartsOf(e);
  const front = `<div style="font-size:1.6em">${word}</div>${sentence ? `<div>${sentence}</div>` : ''}`;
  const source = [occ?.bookTitle, occ?.bookAuthor].filter(Boolean).map((s) => oneLine(s!));
  const back = [hint, source.length ? `<small>${escapeHtml(source.join(' — '))}</small>` : '']
    .filter(Boolean)
    .join('<br>');
  const tags = ['readest', bookTag(occ?.bookTitle)].filter(Boolean);
  return { word, front, back, tags };
};

export const toAnkiText = (entries: VocabularyEntry[]): string => {
  const lines = [
    '#separator:tab',
    '#html:true',
    '#notetype:Basic',
    '#deck:Readest Vocabulary',
    '#tags column:3',
  ];
  for (const e of entries) {
    const { front, back, tags } = ankiCardOf(e);
    lines.push([front, back, tags.join(' ')].join('\t'));
  }
  return `${lines.join('\n')}\n`;
};

const csvField = (v: string | number) => {
  // Book text and hints are untrusted: keep spreadsheet apps from running a
  // cell that starts like a formula.
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The local day: in UTC an early-morning lookup was dated the day before.
const day = (ms: number) => toDateKey(new Date(ms));

export const toCsv = (entries: VocabularyEntry[]): string => {
  const rows = [
    [
      'word',
      'state',
      'hint',
      'latest sentence',
      'all sentences',
      'book',
      'author',
      'first looked up',
      'last looked up',
      'lookup count',
      'language',
    ],
  ];
  for (const e of entries) {
    const occ = latest(e);
    const times = e.occurrences.map((o) => o.at);
    rows.push([
      e.word,
      e.state,
      e.hint ?? '',
      occ?.sentence ?? '',
      e.occurrences.map((o) => o.sentence).join('\n'),
      occ?.bookTitle ?? '',
      occ?.bookAuthor ?? '',
      day(times.length ? Math.min(...times) : e.createdAt),
      day(times.length ? Math.max(...times) : e.createdAt),
      String(e.occurrences.length),
      e.lang,
    ]);
  }
  return `﻿${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
};
