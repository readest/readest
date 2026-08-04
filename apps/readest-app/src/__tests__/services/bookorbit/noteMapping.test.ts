import { describe, expect, it } from 'vitest';
import { md5 } from 'js-md5';
import type { BookNote } from '@/types/book';
import {
  bookOrbitKey,
  bookOrbitNoteId,
  colorForKoColor,
  drawerForNote,
  formatKoDate,
  formatKoDatetime,
  koColorForNote,
  noteToKoAnnotation,
  parseKoDatetime,
  readingStatusToBookOrbit,
  styleForDrawer,
} from '@/services/bookorbit/noteMapping';

const baseNote: BookNote = {
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/1:0)',
  xpointer0: '/body/DocFragment[4]/body/p[3]/text().0',
  xpointer1: '/body/DocFragment[4]/body/p[3]/text().10',
  text: 'quoted text',
  style: 'underline',
  color: 'violet',
  note: 'my comment',
  createdAt: Date.UTC(2026, 7, 1, 12, 30, 5),
  updatedAt: Date.UTC(2026, 7, 1, 12, 30, 5),
};

describe('ko datetime', () => {
  it('formats and parses in the UTC frame, timezone-independent', () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(formatKoDatetime(ms)).toBe('2026-01-02 03:04:05');
    expect(parseKoDatetime('2026-01-02 03:04:05')).toBe(ms);
    expect(formatKoDate(ms)).toBe('2026-01-02');
  });
});

describe('identity', () => {
  it('derives the exchange key as md5(datetime|pos)', () => {
    expect(bookOrbitKey('2026-01-02 03:04:05', '/body/DocFragment[4]/body/p[1]/text().0')).toBe(
      md5('2026-01-02 03:04:05|/body/DocFragment[4]/body/p[1]/text().0'),
    );
  });

  it('derives note ids exactly like readest.koplugin generateNoteId', () => {
    const id = bookOrbitNoteId('abc123', 'annotation', '/p0', '/p1');
    expect(id).toBe(md5('ko:abc123:annotation:/p0:/p1').slice(0, 7));
    expect(bookOrbitNoteId('abc123', 'bookmark', '/p0')).toBe(
      md5('ko:abc123:bookmark:/p0:').slice(0, 7),
    );
  });
});

describe('style and color mapping', () => {
  it('round-trips drawer/style', () => {
    expect(drawerForNote(baseNote)).toBe('underscore');
    expect(drawerForNote({ ...baseNote, style: 'highlight' })).toBe('lighten');
    expect(drawerForNote({ ...baseNote, style: 'squiggly' })).toBe('strikeout');
    expect(styleForDrawer('underscore')).toBe('underline');
    expect(styleForDrawer('strikeout')).toBe('squiggly');
    expect(styleForDrawer('lighten')).toBe('highlight');
    expect(styleForDrawer('invert')).toBe('highlight');
  });

  it('maps colors through the koplugin tables', () => {
    expect(koColorForNote('violet')).toBe('purple');
    expect(colorForKoColor('purple')).toBe('violet');
    expect(koColorForNote('#ff8800')).toBe('orange');
    expect(colorForKoColor('orange')).toBe('#ff8800');
    expect(colorForKoColor('nonexistent')).toBeUndefined();
  });
});

describe('noteToKoAnnotation', () => {
  it('builds the wire annotation from a note with xpointers', () => {
    const ann = noteToKoAnnotation(baseNote, '2026-08-01 12:30:05');
    expect(ann).toEqual({
      datetime: '2026-08-01 12:30:05',
      drawer: 'underscore',
      color: 'purple',
      text: 'quoted text',
      note: 'my comment',
      posFormat: 'xpointer',
      pos0: baseNote.xpointer0,
      pos1: baseNote.xpointer1,
    });
  });

  it('emits datetimeUpdated only for edited notes and null without xpointer', () => {
    const edited = { ...baseNote, updatedAt: baseNote.createdAt + 60_000 };
    expect(noteToKoAnnotation(edited, '2026-08-01 12:30:05')?.datetimeUpdated).toBe(
      '2026-08-01 12:31:05',
    );
    expect(noteToKoAnnotation({ ...baseNote, xpointer0: undefined }, 'x')).toBeNull();
  });
});

describe('readingStatusToBookOrbit', () => {
  it('maps the settable statuses and drops the rest', () => {
    expect(readingStatusToBookOrbit('reading')).toBe('reading');
    expect(readingStatusToBookOrbit('finished')).toBe('complete');
    expect(readingStatusToBookOrbit('abandoned')).toBe('abandoned');
    expect(readingStatusToBookOrbit('unread')).toBeUndefined();
    expect(readingStatusToBookOrbit(undefined)).toBeUndefined();
  });
});
