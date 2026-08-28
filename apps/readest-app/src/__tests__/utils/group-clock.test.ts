import { describe, expect, it } from 'vitest';
import { pickFresherGroup } from '@/utils/book';
import type { Book } from '@/types/book';

const base: Book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 2,
};

const book = (over: Partial<Book>): Book => ({ ...base, ...over });

/**
 * #5911: group membership had no field-level clock, so it rode the row's
 * `updatedAt` — a stamp that `cloudService.uploadBook` bumps on every UPLOAD,
 * and that a stale peer can therefore win with a copy that was never grouped.
 * `groupUpdatedAt` is the group's own clock, mirroring readingStatusUpdatedAt
 * (#4634), coverUpdatedAt (#4544) and metadataUpdatedAt (#5438).
 */
describe('pickFresherGroup (issue #5911)', () => {
  it('takes the side with the newer group stamp', () => {
    const out = pickFresherGroup(
      book({ groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 100 }),
      book({ groupId: 'g2', groupName: 'History', groupUpdatedAt: 200 }),
      false,
    );
    expect(out).toEqual({ groupId: 'g2', groupName: 'History', groupUpdatedAt: 200 });
  });

  it('keeps a stamped group even when the other side wins the row', () => {
    // The reported clobber: a peer's row is "newer" only because its file was
    // uploaded, which bumps updatedAt without touching the group.
    const out = pickFresherGroup(
      book({ groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 300 }),
      book({ updatedAt: 9_000 }),
      true,
    );
    expect(out.groupId).toBe('g1');
    expect(out.groupName).toBe('Sci-Fi');
  });

  it('propagates a STAMPED removal', () => {
    const out = pickFresherGroup(
      book({ groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 100 }),
      book({ groupUpdatedAt: 200 }),
      false,
    );
    expect(out.groupId).toBeUndefined();
    expect(out.groupName).toBeUndefined();
    expect(out.groupUpdatedAt).toBe(200);
  });

  it('an UNSTAMPED ungrouped row never clears a group (the #5911 data loss)', () => {
    // Both sides legacy (0/0). "Never grouped" and "ungrouped by a client too
    // old to stamp" are indistinguishable, so the group is preserved: erasing
    // a real group is unrecoverable, a lost un-group is not.
    const out = pickFresherGroup(
      book({ groupId: 'g1', groupName: 'Sci-Fi' }),
      book({ updatedAt: 9_000 }),
      true,
    );
    expect(out.groupId).toBe('g1');
    expect(out.groupName).toBe('Sci-Fi');
  });

  it('adopts a group the other side has when this one has none', () => {
    const out = pickFresherGroup(book({}), book({ groupId: 'g1', groupName: 'Sci-Fi' }), false);
    expect(out.groupId).toBe('g1');
  });

  it('two different groups on equal stamps fall back to the row winner', () => {
    const a = book({ groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 150 });
    const b = book({ groupId: 'g2', groupName: 'History', groupUpdatedAt: 150 });
    expect(pickFresherGroup(a, b, true).groupId).toBe('g2');
    expect(pickFresherGroup(a, b, false).groupId).toBe('g1');
  });

  it('two ungrouped sides stay ungrouped', () => {
    const out = pickFresherGroup(book({}), book({}), true);
    expect(out.groupId).toBeUndefined();
    expect(out.groupName).toBeUndefined();
  });
});
