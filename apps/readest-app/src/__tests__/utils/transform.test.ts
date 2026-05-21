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

describe('transformBookNote with global flag', () => {
  const baseNote: BookNote = {
    bookHash: 'abc123',
    id: 'note-g',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    text: 'highlighted text',
    note: '',
    style: 'highlight',
    color: 'yellow',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
  };

  it('passes through global=true when serializing to DB', () => {
    const note: BookNote = { ...baseNote, global: true };
    const dbNote = transformBookNoteToDB(note, 'user1');
    expect(dbNote.global).toBe(true);
  });

  it('passes through global=false when serializing to DB', () => {
    const note: BookNote = { ...baseNote, global: false };
    const dbNote = transformBookNoteToDB(note, 'user1');
    expect(dbNote.global).toBe(false);
  });

  it('omits global when undefined (legacy notes)', () => {
    const dbNote = transformBookNoteToDB(baseNote, 'user1');
    expect(dbNote.global).toBeUndefined();
  });

  it('reads global=true from DB', () => {
    const dbNote: DBBookNote = {
      user_id: 'user1',
      book_hash: 'abc123',
      id: 'note-g',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'highlighted text',
      note: '',
      global: true,
      created_at: '2023-11-14T22:13:20.000Z',
      updated_at: '2023-11-14T22:13:21.000Z',
    };
    const note = transformBookNoteFromDB(dbNote);
    expect(note.global).toBe(true);
  });

  it('leaves global undefined when missing from DB', () => {
    const dbNote: DBBookNote = {
      user_id: 'user1',
      book_hash: 'abc123',
      id: 'note-g',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'highlighted text',
      note: '',
      created_at: '2023-11-14T22:13:20.000Z',
      updated_at: '2023-11-14T22:13:21.000Z',
    };
    const note = transformBookNoteFromDB(dbNote);
    expect(note.global).toBeUndefined();
  });

  it('round-trips global=true through DB transform', () => {
    const note: BookNote = { ...baseNote, global: true };
    const db = transformBookNoteToDB(note, 'user1');
    const dbRecord: DBBookNote = {
      ...db,
      created_at: new Date(note.createdAt).toISOString(),
      updated_at: new Date(note.updatedAt).toISOString(),
    };
    const restored = transformBookNoteFromDB(dbRecord);
    expect(restored.global).toBe(true);
  });

  // Regression: an old client that has not been updated to know about
  // `global` will receive a note with global=true from the server, then
  // upsert the same row back during a later sync. The legacy client only
  // copies fields it knows about, so its outgoing payload omits `global`.
  // We simulate that here by stripping `global` from the round-tripped
  // BookNote and re-serializing — the resulting DB payload also omits the
  // column, and the server-side merge therefore preserves the existing
  // global=true value (the column is left untouched on UPDATE).
  it('legacy client round-trip does not actively clear global (column omitted)', () => {
    const note: BookNote = { ...baseNote, global: true };
    const dbFromUpdated = transformBookNoteToDB(note, 'user1');
    const dbRecord: DBBookNote = {
      ...dbFromUpdated,
      created_at: new Date(note.createdAt).toISOString(),
      updated_at: new Date(note.updatedAt).toISOString(),
    };
    const restored = transformBookNoteFromDB(dbRecord);

    // Simulate a legacy client: it doesn't know about `global`, so the
    // field is dropped from the in-memory note before it gets sent back.
    const legacyOutgoing: BookNote = { ...restored };
    delete (legacyOutgoing as { global?: boolean }).global;

    const legacyDb = transformBookNoteToDB(legacyOutgoing, 'user1');
    expect(legacyDb.global).toBeUndefined();
    // The destructure-spread inside transformBookNoteToDB assigns
    // global=undefined as an own property, but JSON.stringify drops keys
    // whose value is undefined. So the wire payload sent to Supabase has
    // no `global` column, and the server-side merge preserves whatever is
    // already stored — which is exactly what we want for legacy clients.
    expect(Object.hasOwn(legacyDb, 'global')).toBe(true);
    expect(JSON.parse(JSON.stringify(legacyDb))).not.toHaveProperty('global');
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
