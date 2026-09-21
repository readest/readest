import { describe, expect, it } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import {
  createBookshelf,
  defaultBookshelves,
  effectiveBookshelves,
} from '@/services/bookshelves/definitions';
import {
  applyBookshelfDraft,
  mergeBookshelfStates,
  readBookshelves,
} from '@/services/bookshelves/state';
import type { BookshelfState } from '@/types/bookshelf';
const clock = new HlcGenerator('test', () => 100);
const empty = (): BookshelfState => ({ rows: {} });
const defaults = () => defaultBookshelves({});
const save = (
  state: BookshelfState,
  base: ReturnType<typeof defaults>,
  draft: ReturnType<typeof defaults>,
) =>
  applyBookshelfDraft(state, base, draft, {
    userId: 'account',
    deviceId: 'test',
    next: () => clock.next(),
  });
describe('bookshelf draft operations', () => {
  it('adds new predefined shelves in order without shifting saved shelves or their edits', () => {
    const base = defaults();
    const changed = save(
      empty(),
      base,
      base.map((s) => (s.id === 'default' ? { ...s, name: 'Main' } : s)),
    ).state;
    const stamp = clock.next();
    changed.rows['default']!.fields_jsonb['position'] = { v: 1024, t: stamp, s: 'test' };
    delete changed.rows['audiobooks'];
    delete changed.rows['podcasts'];
    const shelves = readBookshelves({ bookshelves: changed });
    expect(shelves.map((s) => s.id)).toEqual([
      'recent',
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
    expect(shelves.find((s) => s.id === 'default')?.name).toBe('Main');
    changed.rows['default']!.fields_jsonb['position'] = { v: -1024, t: stamp, s: 'test' };
    expect(readBookshelves({ bookshelves: changed }).map((s) => s.id)).toEqual([
      'default',
      'recent',
      'audiobooks',
      'podcasts',
      'finished',
    ]);
  });
  it('persists Default at any position without overwriting a concurrent rename', () => {
    const base = defaults();
    const renamed = save(
      empty(),
      base,
      base.map((s) => (s.id === 'default' ? { ...s, name: 'Main' } : s)),
    );
    const reordered = save(empty(), base, [
      base.find((s) => s.id === 'default')!,
      ...base.filter((s) => s.id !== 'default'),
    ]);
    const merged = mergeBookshelfStates(renamed.state, reordered.state);
    const shelves = readBookshelves({ bookshelves: merged });
    expect(shelves.map((s) => s.id)).toEqual([
      'default',
      'recent',
      'audiobooks',
      'podcasts',
      'finished',
    ]);
    expect(shelves[0]!.name).toBe('Main');
    expect(
      reordered.operations.every((row) => Object.keys(row.fields_jsonb).join() === 'position'),
    ).toBe(true);
    expect(effectiveBookshelves(shelves).map((s) => s.id)).toEqual([
      'default',
      'recent',
      'audiobooks',
      'podcasts',
      'finished',
    ]);
    const disabled = effectiveBookshelves(shelves.map((s) => ({ ...s, enabled: false })));
    expect(disabled.map((s) => s.id)).toEqual(shelves.map((s) => s.id));
    expect(disabled[0]!.enabled).toBe(true);
    const added = save(merged, shelves, [...shelves, createBookshelf('Last')]);
    expect(readBookshelves({ bookshelves: added.state }).map((s) => s.name)).toEqual([
      'Main',
      '',
      '',
      '',
      '',
      'Last',
    ]);
  });
  it('publishes neither untouched defaults nor a cancelled draft', () => {
    expect(save(empty(), defaults(), defaults()).operations).toEqual([]);
  });
  it('preserves independent remote edits and changes only edited definitions', () => {
    const base = defaults();
    const remote = save(
      empty(),
      base,
      base.map((s) => (s.id === 'recent' ? { ...s, name: 'Remote' } : s)),
    );
    const local = save(
      remote.state,
      base,
      base.map((s) => (s.id === 'default' ? { ...s, name: 'Local' } : s)),
    );
    expect(readBookshelves({ bookshelves: local.state }).map((s) => s.name)).toEqual([
      'Remote',
      '',
      '',
      'Local',
      '',
    ]);
    expect(local.operations).toHaveLength(1);
    expect(Object.keys(local.operations[0]!.fields_jsonb)).toEqual(['definition']);
  });
  it('merges reorders separately from definitions', () => {
    const added = [createBookshelf('A'), ...defaults()];
    const start = save(empty(), defaults(), added).state;
    const rename = save(
      start,
      added,
      added.map((s) => (s.id === added[0]!.id ? { ...s, name: 'Renamed' } : s)),
    );
    const reorder = save(start, added, [added[1]!, added[0]!, ...added.slice(2)]);
    const merged = mergeBookshelfStates(rename.state, reorder.state);
    expect(readBookshelves({ bookshelves: merged }).map((s) => s.name)).toEqual([
      '',
      'Renamed',
      '',
      '',
      '',
      '',
    ]);
  });
  it('inserts between shelves whose concurrent positions tie without changing definitions', () => {
    const base = defaults();
    const a = createBookshelf('A', '00000000-0000-4000-8000-000000000001');
    const b = createBookshelf('B', '00000000-0000-4000-8000-000000000002');
    const c = createBookshelf('C');
    const left = save(empty(), base, [base[0]!, a, ...base.slice(1)]);
    const right = save(empty(), base, [base[0]!, b, ...base.slice(1)]);
    const concurrent = mergeBookshelfStates(left.state, right.state);
    const opening = readBookshelves({ bookshelves: concurrent });
    const added = save(concurrent, opening, [...opening.slice(0, -1), c, opening.at(-1)!]);
    const draft = readBookshelves({ bookshelves: added.state });
    const moved = save(added.state, draft, [draft[0]!, a, c, b, ...base.slice(1)]);
    expect(readBookshelves({ bookshelves: moved.state }).map((s) => s.id)).toEqual([
      'recent',
      a.id,
      c.id,
      b.id,
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
    expect(
      moved.operations.every((row) => Object.keys(row.fields_jsonb).join() === 'position'),
    ).toBe(true);
    for (const id of [a.id, b.id, c.id])
      expect(moved.state.rows[id]!.fields_jsonb['definition']).toEqual(
        added.state.rows[id]!.fields_jsonb['definition'],
      );
  });
  it('uses remove-wins tombstones and prevents stale drafts from resurrecting custom shelves', () => {
    const base = [createBookshelf('A'), ...defaults()];
    const initial = save(empty(), defaults(), base).state;
    const deleted = save(initial, base, defaults()).state;
    const stale = save(
      deleted,
      base,
      base.map((s) => ({ ...s, name: s.name + ' edit' })),
    );
    expect(readBookshelves({ bookshelves: stale.state }).some((s) => s.id === base[0]!.id)).toBe(
      false,
    );
  });
  // The wire schemas are strict, so a row written by a newer client is dropped
  // whole rather than partially applied; a full pull refetches it after upgrade.
  it('drops rows from a newer client and falls back to the built-in definition', () => {
    const base = defaults();
    const renamed = () =>
      save(
        empty(),
        base,
        base.map((s) => (s.id === 'default' ? { ...s, name: 'Main' } : s)),
      ).state;
    expect(readBookshelves({ bookshelves: renamed() }).find((s) => s.id === 'default')?.name).toBe(
      'Main',
    );
    const unknownField = renamed();
    unknownField.rows['default']!.fields_jsonb['color'] = {
      v: 'red',
      t: clock.next(),
      s: 'newer',
    };
    const unknownProperty = renamed();
    (unknownProperty.rows['default']!.fields_jsonb['definition']!.v as Record<string, unknown>)[
      'color'
    ] = 'red';
    const newerSchema = renamed();
    newerSchema.rows['default']!.schema_version = 2;
    for (const state of [unknownField, unknownProperty, newerSchema]) {
      expect(mergeBookshelfStates(state).rows['default']).toBeUndefined();
      const shelves = readBookshelves({ bookshelves: state });
      expect(shelves.map((s) => s.id)).toEqual([
        'recent',
        'audiobooks',
        'podcasts',
        'default',
        'finished',
      ]);
      expect(shelves.find((s) => s.id === 'default')?.name).toBe('');
    }
  });
  it('keeps the saved order once repeated moves exhaust the numeric gap', () => {
    const a = createBookshelf('A', '00000000-0000-4000-8000-00000000000a');
    const b = createBookshelf('B', '00000000-0000-4000-8000-00000000000b');
    const added = [...defaults().slice(0, 2), a, b, ...defaults().slice(2)];
    let state = save(empty(), defaults(), added).state;
    let base = readBookshelves({ bookshelves: state });
    for (let i = 0; i < 60; i++) {
      const draft = [...base.slice(0, 2), base[3]!, base[2]!, ...base.slice(4)];
      state = save(state, base, draft).state;
      base = readBookshelves({ bookshelves: state });
      expect(base.map((s) => s.id)).toEqual(draft.map((s) => s.id));
    }
  });
  it('protects built-ins and the last enabled shelf', () => {
    expect(() => save(empty(), defaults(), defaults().slice(1))).toThrow();
    expect(() =>
      save(
        empty(),
        defaults(),
        defaults().filter((s) => s.id !== 'finished'),
      ),
    ).toThrow();
    expect(() =>
      save(
        empty(),
        defaults(),
        defaults().map((s) => ({ ...s, enabled: false })),
      ),
    ).toThrow();
  });
});
