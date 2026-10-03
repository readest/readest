import { describe, expect, it } from 'vitest';
import { validateRow } from '@/libs/replicaSchemas';
import { HlcGenerator } from '@/libs/crdt';
import { bookshelfSchema, createBookshelf } from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import {
  getActiveBookshelfGroupBy,
  resolveBookshelfGroupBy,
} from '@/services/bookshelves/grouping';
import type { ReplicaRow } from '@/types/replica';
const clock = new HlcGenerator('device');
const makeRow = (): ReplicaRow => {
  const t = clock.next();
  const definition = createBookshelf('Shelf');
  return {
    user_id: 'account',
    kind: 'bookshelf',
    replica_id: definition.id,
    fields_jsonb: { definition: { v: definition, t, s: 'device' } },
    updated_at_ts: t,
    deleted_at_ts: null,
    reincarnation: null,
    manifest_jsonb: null,
    schema_version: 1,
  };
};
describe('bookshelf validation boundaries', () => {
  it('preserves legacy skeuomorphic covers and round-trips independent shelf choices', () => {
    expect(createBookshelf('New').skeuomorphicCovers).toBe(false);
    const row = makeRow();
    const definition = createBookshelf('Existing', row.replica_id);
    delete definition.skeuomorphicCovers;
    row.fields_jsonb['definition']!.v = definition;
    const settings = {
      librarySkeuomorphicCovers: true,
      bookshelves: { rows: { [row.replica_id]: row } },
    };
    expect(validateRow(row).ok).toBe(true);
    expect(readBookshelves(settings).every((s) => s.skeuomorphicCovers)).toBe(true);
    for (const skeuomorphicCovers of [false, true]) {
      row.fields_jsonb['definition']!.v = { ...definition, skeuomorphicCovers };
      expect(validateRow(row).ok).toBe(true);
      expect(
        readBookshelves(settings).find((s) => s.id === row.replica_id)?.skeuomorphicCovers,
      ).toBe(skeuomorphicCovers);
    }
    row.fields_jsonb['definition']!.v = { ...definition, skeuomorphicCovers: 'invalid' };
    expect(validateRow(row).ok).toBe(false);
  });
  it('round-trips relative date filters through synced definitions', () => {
    const row = makeRow();
    const definition = createBookshelf('Recent additions', row.replica_id);
    definition.filters.children = [
      {
        type: 'rule',
        field: 'created',
        kind: 'date',
        operator: 'withinLast',
        value: 3,
        unit: 'months',
      },
    ];
    row.fields_jsonb['definition']!.v = definition;
    expect(validateRow(row).ok).toBe(true);
    const restored = readBookshelves({
      bookshelves: { rows: { [row.replica_id]: JSON.parse(JSON.stringify(row)) } },
    });
    expect(restored.find((s) => s.id === row.replica_id)?.filters).toEqual(definition.filters);
  });
  it('inherits global grouping for older definitions and validates independent choices', () => {
    const row = makeRow();
    const definition = createBookshelf('Existing', row.replica_id);
    expect(definition.useGlobalGrouping).toBe(true);
    delete definition.useGlobalGrouping;
    delete definition.groupBy;
    row.fields_jsonb['definition']!.v = definition;
    expect(validateRow(row).ok).toBe(true);
    expect(resolveBookshelfGroupBy(definition, 'series')).toBe('series');
    for (const groupBy of ['author', 'none', 'group', 'series', 'tag', 'subject', 'status']) {
      row.fields_jsonb['definition']!.v = { ...definition, useGlobalGrouping: false, groupBy };
      expect(validateRow(row).ok).toBe(true);
    }
    row.fields_jsonb['definition']!.v = { ...definition, groupBy: 'invalid' };
    expect(validateRow(row).ok).toBe(false);
  });
  it('resolves navigation grouping from the originating shelf, preserving legacy links', () => {
    const row = makeRow();
    row.fields_jsonb['definition']!.v = {
      ...createBookshelf('Authors', row.replica_id),
      useGlobalGrouping: false,
      groupBy: 'author',
    };
    const settings = {
      libraryGroupBy: 'none' as const,
      bookshelves: { rows: { [row.replica_id]: row } },
    };
    expect(
      getActiveBookshelfGroupBy(
        settings,
        new URLSearchParams({ group: 'id', shelf: row.replica_id }),
      ),
    ).toBe('author');
    expect(
      getActiveBookshelfGroupBy(settings, new URLSearchParams({ group: 'id', groupBy: 'series' })),
    ).toBe('series');
    expect(
      getActiveBookshelfGroupBy(settings, new URLSearchParams({ shelf: row.replica_id })),
    ).toBe('none');
  });
  it('inherits legacy cover sizing and validates independent shelf choices', () => {
    const row = makeRow();
    const definition = createBookshelf('Existing', row.replica_id);
    delete definition.coverFit;
    const settings = {
      libraryCoverFit: 'fit' as const,
      bookshelves: { rows: { [row.replica_id]: row } },
    };
    row.fields_jsonb['definition']!.v = definition;
    expect(
      readBookshelves(settings)
        .filter((s) => !['audiobooks', 'podcasts'].includes(s.id))
        .every((s) => s.coverFit === 'fit'),
    ).toBe(true);
    row.fields_jsonb['definition']!.v = { ...definition, coverFit: 'crop' };
    expect(validateRow(row).ok).toBe(true);
    expect(readBookshelves(settings).find((s) => s.id === row.replica_id)?.coverFit).toBe('crop');
    row.fields_jsonb['definition']!.v = { ...definition, coverFit: 'stretch' };
    expect(validateRow(row).ok).toBe(false);
  });
  it('migrates cover visibility without dropping older saved definitions', () => {
    expect(createBookshelf('New').hideCovers).toBe(false);
    const row = makeRow();
    const definition = createBookshelf('Existing', row.replica_id);
    delete definition.hideCovers;
    row.fields_jsonb['definition']!.v = definition;
    const settings = { libraryHideCovers: true, bookshelves: { rows: { [row.replica_id]: row } } };
    expect(validateRow(row).ok).toBe(true);
    expect(
      readBookshelves(settings)
        .filter((s) => !['audiobooks', 'podcasts'].includes(s.id))
        .every((s) => s.hideCovers),
    ).toBe(true);
    row.fields_jsonb['definition']!.v = { ...definition, hideCovers: false };
    expect(validateRow(row).ok).toBe(true);
    expect(readBookshelves(settings).find((s) => s.id === row.replica_id)?.hideCovers).toBe(false);
    row.fields_jsonb['definition']!.v = { ...definition, hideCovers: 'invalid' };
    expect(validateRow(row).ok).toBe(false);
  });
  it('accepts atomic definitions and independently stamped positions', () => {
    const row = makeRow();
    expect(validateRow(row).ok).toBe(true);
    row.fields_jsonb = { position: { v: 0.5, t: row.updated_at_ts, s: 'device' } };
    expect(validateRow(row).ok).toBe(true);
  });
  it('rejects unfiltered exclusivity, mismatched identity, binary data and built-in deletion', () => {
    const row = makeRow();
    row.fields_jsonb['definition']!.v = {
      ...createBookshelf('Shelf', row.replica_id),
      exclusive: true,
    };
    expect(validateRow(row).ok).toBe(false);
    const valid = makeRow();
    expect(validateRow({ ...valid, replica_id: 'default' }).ok).toBe(false);
    expect(validateRow({ ...valid, manifest_jsonb: { files: [], schemaVersion: 1 } }).ok).toBe(
      false,
    );
    expect(
      validateRow({
        ...valid,
        replica_id: 'recent',
        fields_jsonb: {},
        deleted_at_ts: valid.updated_at_ts,
      }).ok,
    ).toBe(false);
  });
  it('rejects technical fields, invalid dates, malformed nested groups and invalid limits', () => {
    for (const field of ['hash', 'filePath', 'syncedAt'])
      expect(
        bookshelfSchema.safeParse({
          ...createBookshelf('Shelf'),
          filters: {
            type: 'group',
            match: 'all',
            children: [{ type: 'rule', field, kind: 'text', operator: 'set' }],
          },
        }).success,
      ).toBe(false);
    for (const limit of [0, -1, 1.5, Infinity])
      expect(bookshelfSchema.safeParse({ ...createBookshelf('Shelf'), limit }).success).toBe(false);
  });
  it('rejects definitions too large for a synced row before the editor reports success', () => {
    const definition = createBookshelf('Huge');
    const condition = {
      type: 'rule' as const,
      field: 'title',
      kind: 'text' as const,
      operator: 'contains' as const,
      value: 'x'.repeat(4000),
    };
    definition.filters.children = Array.from({ length: 20 }, () => ({ ...condition }));
    expect(bookshelfSchema.safeParse(definition).success).toBe(false);
    const row = makeRow();
    row.replica_id = definition.id;
    row.fields_jsonb['definition']!.v = definition;
    expect(validateRow(row).ok).toBe(false);
    definition.filters.children = [{ ...condition }, { ...condition }];
    expect(bookshelfSchema.safeParse(definition).success).toBe(true);
    expect(validateRow(row).ok).toBe(true);
  });
  it('does not interpret malformed incoming exclusive definitions as unfiltered shelves', () => {
    const row = makeRow();
    row.fields_jsonb['definition']!.v = {
      ...createBookshelf('Shelf', row.replica_id),
      exclusive: true,
      filters: null,
    };
    expect(
      readBookshelves({ bookshelves: { rows: { [row.replica_id]: row } } }).some(
        (s) => s.id === row.replica_id,
      ),
    ).toBe(false);
  });
});
