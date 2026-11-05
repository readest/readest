import { describe, expect, test } from 'vitest';
import type { BookNote } from '@/types/book';
import {
  annotationToRemoteNote,
  colorFromGrimmory,
  colorToGrimmory,
  parseGrimmoryDatetime,
  planNotesSync,
  type GrimmoryNoteLink,
  type RemoteNote,
} from '@/services/grimmory/notesSync';

const palette = { yellow: '#facc15', green: '#4ade80', red: '#f87171' };
const NOW = 1_800_000_000_000;

const highlight = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/10,/1:0,/1:20)',
  text: 'Down the Rabbit-Hole',
  note: '',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const remoteHighlight = (overrides: Partial<RemoteNote> = {}): RemoteNote => ({
  id: 11,
  cfi: 'epubcfi(/6/8!/4/2/10,/1:0,/1:20)',
  text: 'Down the Rabbit-Hole',
  note: '',
  style: 'highlight',
  color: 'yellow',
  createdAt: 500,
  ...overrides,
});

const link = (overrides: Partial<GrimmoryNoteLink> = {}): GrimmoryNoteLink => ({
  noteId: 'n1',
  kind: 'annotation',
  serverId: 11,
  localUpdatedAt: 1000,
  ...overrides,
});

const plan = (notes: BookNote[], remote: RemoteNote[], links: GrimmoryNoteLink[] = []) => {
  let next = 0;
  return planNotesSync({
    kind: 'annotation',
    notes,
    remote,
    links,
    palette,
    now: NOW,
    newId: () => `new-${++next}`,
  });
};

describe('colors and dates', () => {
  test('palette names go out as uppercase hex and come back as the name', () => {
    expect(colorToGrimmory('yellow', palette)).toBe('#FACC15');
    expect(colorFromGrimmory('#FACC15', palette)).toBe('yellow');
    expect(colorFromGrimmory('#38BDF8', palette)).toBe('#38bdf8');
    expect(colorToGrimmory('#38bdf8', palette)).toBe('#38BDF8');
  });

  test('a zone-less server datetime reads as UTC', () => {
    expect(parseGrimmoryDatetime('2026-11-05T14:04:52')).toBe(Date.UTC(2026, 10, 5, 14, 4, 52));
    expect(parseGrimmoryDatetime('2026-11-05T14:04:52Z')).toBe(Date.UTC(2026, 10, 5, 14, 4, 52));
  });

  test('a strikethrough from Grimmory reads as an underline', () => {
    const note = annotationToRemoteNote(
      { id: 1, bookId: 2, cfi: 'c', text: 't', style: 'strikethrough', color: '#4ADE80' },
      palette,
    );
    expect(note).toMatchObject({ style: 'underline', color: 'green' });
  });
});

describe('planNotesSync', () => {
  test('a new local highlight is created on the server', () => {
    const result = plan([highlight()], []);
    expect(result.createRemote.map((n) => n.id)).toEqual(['n1']);
    expect(result.upsertLocal).toEqual([]);
  });

  test('a new server highlight is added here under a new id and linked', () => {
    const result = plan([], [remoteHighlight({ note: 'curious', color: 'green' })]);
    expect(result.upsertLocal).toEqual([
      expect.objectContaining({
        id: 'new-1',
        type: 'annotation',
        cfi: remoteHighlight().cfi,
        note: 'curious',
        color: 'green',
      }),
    ]);
    expect(result.links).toEqual([link({ noteId: 'new-1', localUpdatedAt: NOW })]);
  });

  test('unlinked copies at the same CFI pair up instead of duplicating', () => {
    const result = plan([highlight()], [remoteHighlight()]);
    expect(result.createRemote).toEqual([]);
    expect(result.upsertLocal).toEqual([]);
    expect(result.links).toEqual([link()]);
  });

  test('a note edited here since the last pass goes to the server', () => {
    const edited = highlight({ note: 'mine', updatedAt: 2000 });
    const result = plan([edited], [remoteHighlight()], [link()]);
    expect(result.updateRemote).toEqual([{ note: edited, serverId: 11 }]);
    expect(result.upsertLocal).toEqual([]);
  });

  test('a note edited only on the server comes here', () => {
    const result = plan(
      [highlight()],
      [remoteHighlight({ note: 'theirs', color: 'red' })],
      [link()],
    );
    expect(result.updateRemote).toEqual([]);
    expect(result.upsertLocal).toEqual([
      expect.objectContaining({ id: 'n1', note: 'theirs', color: 'red', updatedAt: NOW }),
    ]);
    expect(result.links).toEqual([link({ localUpdatedAt: NOW })]);
  });

  test('a highlight deleted on the server is deleted here', () => {
    const result = plan([highlight()], [], [link()]);
    expect(result.deleteLocal).toEqual(['n1']);
    expect(result.links).toEqual([]);
  });

  test('a highlight deleted here is deleted on the server', () => {
    const result = plan(
      [highlight({ deletedAt: 3000, updatedAt: 3000 })],
      [remoteHighlight()],
      [link()],
    );
    expect(result.deleteRemote).toEqual([11]);
    expect(result.upsertLocal).toEqual([]);
  });

  test('deleting here before the first pass still deletes the server copy', () => {
    const result = plan([highlight({ deletedAt: 3000 })], [remoteHighlight({ createdAt: 500 })]);
    expect(result.deleteRemote).toEqual([11]);
    expect(result.upsertLocal).toEqual([]);
  });

  test('a server highlight made after a local deletion at that CFI is kept', () => {
    const result = plan([highlight({ deletedAt: 3000 })], [remoteHighlight({ createdAt: 4000 })]);
    expect(result.deleteRemote).toEqual([]);
    expect(result.upsertLocal).toHaveLength(1);
  });

  test('a linked note missing here without a tombstone is restored, not deleted', () => {
    const result = plan([], [remoteHighlight()], [link()]);
    expect(result.deleteRemote).toEqual([]);
    expect(result.upsertLocal).toEqual([expect.objectContaining({ id: 'n1' })]);
  });

  test('handwriting and highlights without text stay local', () => {
    const result = plan(
      [
        highlight({ id: 'ink', ink: [{ points: [] }] as unknown as BookNote['ink'] }),
        highlight({ id: 'empty', text: '' }),
      ],
      [],
    );
    expect(result.createRemote).toEqual([]);
  });
});
