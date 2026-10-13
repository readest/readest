import { describe, expect, it } from 'vitest';
import { bookGroupChanged, resolveGroupMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

const grouped = {
  group_id: 'g1',
  group_name: 'Sci-Fi',
  group_updated_at: null as string | null,
};

const ungrouped = {
  group_id: undefined as string | undefined,
  group_name: undefined as string | undefined,
  group_updated_at: null as string | null,
};

/**
 * Server-side field-level LWW for group membership (issue #5911), the mirror
 * of resolveReadingStatusMerge (#4634), resolveCoverMerge (#4544) and
 * resolveMetadataMerge (#5438).
 */
describe('resolveGroupMerge (issue #5911)', () => {
  it('keeps the client group when its group_updated_at is newer', () => {
    const out = resolveGroupMerge(
      { ...grouped, group_updated_at: iso(200) },
      { ...ungrouped, group_updated_at: iso(100) },
      false,
    );
    expect(out).toEqual({ ...grouped, group_updated_at: iso(200) });
  });

  it('keeps the server group when its stamp is newer even though the client wins the row', () => {
    // The reported clobber: the client row is newer only because its file was
    // uploaded (cloudService.uploadBook bumps updated_at), not because the
    // group changed.
    const out = resolveGroupMerge(
      { ...ungrouped, group_updated_at: iso(100) },
      { ...grouped, group_updated_at: iso(300) },
      true,
    );
    expect(out).toEqual({ ...grouped, group_updated_at: iso(300) });
  });

  it('propagates a STAMPED removal', () => {
    const out = resolveGroupMerge(
      { ...ungrouped, group_updated_at: iso(300) },
      { ...grouped, group_updated_at: iso(100) },
      false,
    );
    expect(out.group_id).toBeUndefined();
    expect(out.group_name).toBeUndefined();
  });

  it('an UNSTAMPED ungrouped client never clears the server group (#5911)', () => {
    const out = resolveGroupMerge({ ...ungrouped }, { ...grouped }, true);
    expect(out.group_id).toBe('g1');
    expect(out.group_name).toBe('Sci-Fi');
  });

  it('two different groups on equal stamps follow the row winner', () => {
    const client = { group_id: 'g1', group_name: 'Sci-Fi', group_updated_at: iso(150) };
    const server = { group_id: 'g2', group_name: 'History', group_updated_at: iso(150) };
    expect(resolveGroupMerge(client, server, true)).toEqual(client);
    expect(resolveGroupMerge(client, server, false)).toEqual(server);
  });
});

describe('bookGroupChanged', () => {
  it('false when the resolved group matches the server (no propagation churn)', () => {
    expect(bookGroupChanged(grouped, { ...grouped })).toBe(false);
  });

  it('treats undefined and null as the same "no group"', () => {
    expect(
      bookGroupChanged(
        { group_id: undefined, group_name: undefined },
        { group_id: null as unknown as undefined, group_name: null as unknown as undefined },
      ),
    ).toBe(false);
  });

  it('true when the group differs', () => {
    expect(bookGroupChanged(grouped, ungrouped)).toBe(true);
  });
});
