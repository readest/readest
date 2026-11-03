import type { VocabularyEntry } from './types';

// Vocabulary export (#789): an Anki text-import file (the header lines make it
// import without field mapping) and a CSV for spreadsheets / other apps.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const oneLine = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scripts written without spaces have no word boundaries to respect.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Bold `word` inside an already-escaped sentence. */
const boldWord = (sentence: string, word: string): string => {
  const w = escapeRegExp(escapeHtml(word));
  const re = UNSPACED.test(word)
    ? new RegExp(w, 'giu')
    : new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${w}(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
  return sentence.replace(re, (m) => `<b>${m}</b>`);
};

const latest = (e: VocabularyEntry) => e.occurrences[0];

const bookTag = (title?: string) => (title ? title.trim().replace(/\s+/g, '_') : '');

export const toAnkiText = (entries: VocabularyEntry[]): string => {
  const lines = [
    '#separator:tab',
    '#html:true',
    '#notetype:Basic',
    '#deck:Readest Vocabulary',
    '#tags column:3',
  ];
  for (const e of entries) {
    const occ = latest(e);
    const word = escapeHtml(oneLine(e.word));
    const sentence = occ ? boldWord(escapeHtml(oneLine(occ.sentence)), oneLine(e.word)) : '';
    const front = `<div style="font-size:1.6em">${word}</div>${sentence ? `<div>${sentence}</div>` : ''}`;
    const source = [occ?.bookTitle, occ?.bookAuthor].filter(Boolean).map((s) => oneLine(s!));
    const back = [
      escapeHtml(oneLine(e.hint ?? '')),
      source.length ? `<small>${escapeHtml(source.join(' — '))}</small>` : '',
    ]
      .filter(Boolean)
      .join('<br>');
    const tags = ['readest', bookTag(occ?.bookTitle)].filter(Boolean).join(' ');
    lines.push([front, back, tags].join('\t'));
  }
  return `${lines.join('\n')}\n`;
};

const csvField = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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
    ]);
  }
  return `﻿${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
};
