import { describe, expect, it } from 'vitest';
import { bookMetadataChanged, resolveMetadataMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

const clientFields = {
  title: 'Edited Title',
  author: 'Edited Author',
  tags: ['news'],
  metadata: '{"language":"sv"}',
  metadata_updated_at: null as string | null,
};

const serverFields = {
  title: 'Old Title',
  author: 'Old Author',
  tags: ['old'],
  metadata: '{"language":"en"}',
  metadata_updated_at: null as string | null,
};

describe('resolveMetadataMerge (issue #5438)', () => {
  it('keeps the client metadata when its metadata_updated_at is newer', () => {
    const out = resolveMetadataMerge(
      { ...clientFields, metadata_updated_at: iso(200) },
      { ...serverFields, metadata_updated_at: iso(100) },
      false,
    );
    expect(out).toEqual({ ...clientFields, metadata_updated_at: iso(200) });
  });

  it('keeps the server metadata when its stamp is newer, even when the client wins the row', () => {
    // The reported clobber: another device turns a page (newer updated_at,
    // stale metadata) after this metadata was edited. The row goes to the
    // client, but the metadata edit must survive.
    const out = resolveMetadataMerge(
      { ...clientFields, metadata_updated_at: iso(100) },
      { ...serverFields, metadata_updated_at: iso(300) },
      true,
    );
    expect(out).toEqual({ ...serverFields, metadata_updated_at: iso(300) });
  });

  it('falls back to the row winner when neither side is stamped (legacy rows)', () => {
    expect(resolveMetadataMerge(clientFields, serverFields, true)).toEqual(clientFields);
    expect(resolveMetadataMerge(clientFields, serverFields, false)).toEqual(serverFields);
  });

  it('equal stamps follow the row winner', () => {
    const client = { ...clientFields, metadata_updated_at: iso(150) };
    const server = { ...serverFields, metadata_updated_at: iso(150) };
    expect(resolveMetadataMerge(client, server, true)).toEqual(client);
    expect(resolveMetadataMerge(client, server, false)).toEqual(server);
  });
});

describe('bookMetadataChanged', () => {
  it('false when every field matches (no propagation churn)', () => {
    expect(bookMetadataChanged(serverFields, { ...serverFields })).toBe(false);
  });

  it('treats undefined and null metadata/tags as equal', () => {
    expect(
      bookMetadataChanged(
        { title: 'T', author: 'A', tags: undefined, metadata: undefined },
        { title: 'T', author: 'A', tags: undefined, metadata: null },
      ),
    ).toBe(false);
  });

  it('true when the metadata payload differs', () => {
    expect(bookMetadataChanged(clientFields, serverFields)).toBe(true);
  });

  it('true when only tags differ', () => {
    expect(bookMetadataChanged({ ...serverFields, tags: ['other'] }, serverFields)).toBe(true);
  });
});
