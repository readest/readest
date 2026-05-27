import { describe, test, expect, vi } from 'vitest';
import { drainInbox, type InboxDrainerDeps } from '@/services/send/inboxDrainer';
import type { DBSendInboxItem } from '@/types/sendRecords';

function makeItem(overrides: Partial<DBSendInboxItem> = {}): DBSendInboxItem {
  return {
    id: 'item1',
    user_id: 'user1',
    kind: 'file',
    source: 'email',
    payload_key: 'inbox/user1/item1/book.epub',
    url: null,
    filename: 'book.epub',
    subject_tag: null,
    byte_size: 1000,
    status: 'claimed',
    claimed_by: 'device1',
    claimed_at: new Date().toISOString(),
    attempts: 0,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDeps(over: Partial<InboxDrainerDeps> = {}): InboxDrainerDeps {
  return {
    claimItem: vi.fn().mockResolvedValue(null),
    renewClaim: vi.fn().mockResolvedValue(true),
    completeItem: vi.fn().mockResolvedValue(true),
    failItem: vi.fn().mockResolvedValue(true),
    resolvePayload: vi.fn().mockResolvedValue(new File(['x'], 'book.epub')),
    importItem: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('drainInbox', () => {
  test('does nothing when the inbox is empty', async () => {
    const deps = makeDeps();
    const result = await drainInbox(deps);
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(deps.importItem).not.toHaveBeenCalled();
  });

  test('claims, imports, and completes one item', async () => {
    const item = makeItem();
    const deps = makeDeps({
      claimItem: vi.fn().mockResolvedValueOnce(item).mockResolvedValue(null),
    });
    const result = await drainInbox(deps);
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(deps.importItem).toHaveBeenCalledOnce();
    expect(deps.completeItem).toHaveBeenCalledWith('item1');
    expect(deps.failItem).not.toHaveBeenCalled();
  });

  test('marks an item failed when the import throws', async () => {
    const deps = makeDeps({
      claimItem: vi.fn().mockResolvedValueOnce(makeItem()).mockResolvedValue(null),
      importItem: vi.fn().mockRejectedValue(new Error('conversion failed')),
    });
    const result = await drainInbox(deps);
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(deps.failItem).toHaveBeenCalledWith('item1', 'conversion failed');
    expect(deps.completeItem).not.toHaveBeenCalled();
  });

  test('stops at maxItems even when more items remain', async () => {
    const deps = makeDeps({
      claimItem: vi.fn().mockResolvedValue(makeItem()),
    });
    const result = await drainInbox(deps, 3);
    expect(result.processed).toBe(3);
    expect(deps.claimItem).toHaveBeenCalledTimes(3);
  });

  test('a failed payload cleanup does not fail the item', async () => {
    const deps = makeDeps({
      claimItem: vi.fn().mockResolvedValueOnce(makeItem()).mockResolvedValue(null),
      deletePayload: vi.fn().mockRejectedValue(new Error('R2 down')),
    });
    const result = await drainInbox(deps);
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(deps.completeItem).toHaveBeenCalledOnce();
  });

  test('drains a mix of successes and failures', async () => {
    const deps = makeDeps({
      claimItem: vi
        .fn()
        .mockResolvedValueOnce(makeItem({ id: 'a' }))
        .mockResolvedValueOnce(makeItem({ id: 'b' }))
        .mockResolvedValue(null),
      importItem: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('bad')),
    });
    const result = await drainInbox(deps);
    expect(result).toEqual({ processed: 1, failed: 1 });
  });
});
