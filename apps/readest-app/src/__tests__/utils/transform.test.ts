import { describe, it, expect } from 'vitest';
import {
  transformBookNoteToDB,
  transformBookNoteFromDB,
  transformBookConfigToDB,
  transformBookConfigFromDB,
} from '@/utils/transform';
import { BookConfig, BookNote } from '@/types/book';
import { DBBookConfig, DBBookNote } from '@/types/records';

describe('transformBookNoteToDB with xpointer fields', () => {
  it('passes through xpointer0 and xpointer1', () => {
    const note: BookNote = {
      bookHash: 'abc123',
      metaHash: 'meta456',
      id: 'note1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      xpointer0: '/body/DocFragment[2]/body/div[1]/p[1]/text().0',
      xpointer1: '/body/DocFragment[2]/body/div[1]/p[1]/text().50',
      text: 'highlighted text',
      note: 'my note',
      style: 'highlight',
      color: 'yellow',
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    };

    const dbNote = transformBookNoteToDB(note, 'user1');

    expect(dbNote.xpointer0).toBe('/body/DocFragment[2]/body/div[1]/p[1]/text().0');
    expect(dbNote.xpointer1).toBe('/body/DocFragment[2]/body/div[1]/p[1]/text().50');
    expect(dbNote.cfi).toBe('epubcfi(/6/4!/4/2/1:0)');
  });

  it('handles missing xpointer fields (Readest-only note)', () => {
    const note: BookNote = {
      bookHash: 'abc123',
      id: 'note2',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'text',
      note: '',
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    };

    const dbNote = transformBookNoteToDB(note, 'user1');

    expect(dbNote.xpointer0).toBeUndefined();
    expect(dbNote.xpointer1).toBeUndefined();
    expect(dbNote.cfi).toBe('epubcfi(/6/4!/4/2/1:0)');
  });
});

describe('transformBookNoteFromDB with xpointer fields', () => {
  it('reads xpointer0 and xpointer1 from DB', () => {
    const dbNote: DBBookNote = {
      user_id: 'user1',
      book_hash: 'abc123',
      meta_hash: 'meta456',
      id: 'note1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      xpointer0: '/body/DocFragment[2]/body/div[1]/p[1]/text().0',
      xpointer1: '/body/DocFragment[2]/body/div[1]/p[1]/text().50',
      text: 'highlighted text',
      note: 'my note',
      style: 'highlight',
      color: 'yellow',
      created_at: '2023-11-14T22:13:20.000Z',
      updated_at: '2023-11-14T22:13:21.000Z',
    };

    const note = transformBookNoteFromDB(dbNote);

    expect(note.xpointer0).toBe('/body/DocFragment[2]/body/div[1]/p[1]/text().0');
    expect(note.xpointer1).toBe('/body/DocFragment[2]/body/div[1]/p[1]/text().50');
    expect(note.cfi).toBe('epubcfi(/6/4!/4/2/1:0)');
  });

  it('handles missing xpointer fields from DB', () => {
    const dbNote: DBBookNote = {
      user_id: 'user1',
      book_hash: 'abc123',
      id: 'note2',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      note: '',
      created_at: '2023-11-14T22:13:20.000Z',
      updated_at: '2023-11-14T22:13:21.000Z',
    };

    const note = transformBookNoteFromDB(dbNote);

    expect(note.xpointer0).toBeUndefined();
    expect(note.xpointer1).toBeUndefined();
  });

  it('defaults cfi to empty string when missing from DB (KOReader note)', () => {
    const dbNote: DBBookNote = {
      user_id: 'user1',
      book_hash: 'abc123',
      id: 'note3',
      type: 'annotation',
      xpointer0: '/body/DocFragment[1]/body/p[1]/text().0',
      xpointer1: '/body/DocFragment[1]/body/p[1]/text().20',
      note: '',
      created_at: '2023-11-14T22:13:20.000Z',
      updated_at: '2023-11-14T22:13:21.000Z',
    };

    const note = transformBookNoteFromDB(dbNote);

    expect(note.cfi).toBe('');
    expect(note.xpointer0).toBe('/body/DocFragment[1]/body/p[1]/text().0');
    expect(note.xpointer1).toBe('/body/DocFragment[1]/body/p[1]/text().20');
  });
});

describe('transformBookConfigToDB / transformBookConfigFromDB rsvpPosition', () => {
  const baseConfig: BookConfig = {
    bookHash: 'hash1',
    updatedAt: 1700000000000,
  };

  it('serializes rsvpPosition to JSON string in DB record', () => {
    const config: BookConfig = {
      ...baseConfig,
      rsvpPosition: { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'hello' },
    };
    const db = transformBookConfigToDB(config, 'user1');
    expect(db.rsvp_position).toBe(
      JSON.stringify({ cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'hello' }),
    );
  });

  it('omits rsvp_position when rsvpPosition is undefined', () => {
    const db = transformBookConfigToDB(baseConfig, 'user1');
    expect(db.rsvp_position).toBeUndefined();
  });

  it('deserializes rsvp_position from DB record', () => {
    const dbConfig: DBBookConfig = {
      user_id: 'user1',
      book_hash: 'hash1',
      rsvp_position: JSON.stringify({ cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'hello' }),
      updated_at: '2023-11-14T22:13:20.000Z',
    };
    const config = transformBookConfigFromDB(dbConfig);
    expect(config.rsvpPosition).toEqual({ cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'hello' });
  });

  it('leaves rsvpPosition undefined when rsvp_position is absent from DB', () => {
    const dbConfig: DBBookConfig = {
      user_id: 'user1',
      book_hash: 'hash1',
      updated_at: '2023-11-14T22:13:20.000Z',
    };
    const config = transformBookConfigFromDB(dbConfig);
    expect(config.rsvpPosition).toBeUndefined();
  });

  it('round-trips rsvpPosition through DB transform', () => {
    const config: BookConfig = {
      ...baseConfig,
      rsvpPosition: { cfi: 'epubcfi(/6/8!/4/2/3:5)', wordText: 'world' },
    };
    const db = transformBookConfigToDB(config, 'user1');
    // Simulate what DB returns (updated_at as ISO string)
    const dbRecord: DBBookConfig = { ...db, updated_at: new Date(config.updatedAt).toISOString() };
    const restored = transformBookConfigFromDB(dbRecord);
    expect(restored.rsvpPosition).toEqual(config.rsvpPosition);
  });
});
