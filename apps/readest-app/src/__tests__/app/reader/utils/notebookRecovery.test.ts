import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOTEBOOK_RECOVERY_VERSION,
  clearNotebookRecovery,
  createNotebookRecoveryEntry,
  getNotebookContentHash,
  getNotebookRecoveryKey,
  readNotebookRecovery,
  resolveNotebookRecovery,
  writeNotebookRecovery,
} from '@/app/reader/utils/notebookRecovery';

describe('Notebook recovery helpers', () => {
  beforeEach(() => localStorage.clear());

  it('namespaces recovery by profile and book hash', () => {
    expect(getNotebookRecoveryKey('user@example.com', 'book-hash')).toBe(
      'readest:notebook-recovery:user%40example.com:book-hash',
    );
  });

  it('round-trips a versioned recovery entry', () => {
    const key = getNotebookRecoveryKey('profile', 'book');
    const entry = createNotebookRecoveryEntry({
      content: 'draft',
      baseContent: 'saved',
      baseUpdatedAt: 100,
      revision: 2,
    });

    expect(writeNotebookRecovery(localStorage, key, entry)).toBe(true);
    expect(readNotebookRecovery(localStorage, key)).toEqual({
      version: NOTEBOOK_RECOVERY_VERSION,
      content: 'draft',
      baseHash: getNotebookContentHash('saved'),
      baseUpdatedAt: 100,
      revision: 2,
    });
  });

  it('ignores corrupt and unsupported recovery data', () => {
    const key = getNotebookRecoveryKey('profile', 'book');
    localStorage.setItem(key, '{bad json');
    expect(readNotebookRecovery(localStorage, key)).toBeNull();

    localStorage.setItem(key, JSON.stringify({ version: 99, content: 'draft' }));
    expect(readNotebookRecovery(localStorage, key)).toBeNull();
  });

  it('reports storage failures without throwing', () => {
    const failingStorage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new DOMException('blocked');
      },
      key: () => null,
      removeItem: () => {
        throw new DOMException('blocked');
      },
      setItem: () => {
        throw new DOMException('blocked');
      },
    };
    const entry = createNotebookRecoveryEntry({
      content: 'draft',
      baseContent: '',
      baseUpdatedAt: null,
      revision: 1,
    });

    expect(writeNotebookRecovery(failingStorage, 'key', entry)).toBe(false);
    expect(readNotebookRecovery(failingStorage, 'key')).toBeNull();
    expect(clearNotebookRecovery(failingStorage, 'key')).toBe(false);
  });

  it('restores automatically when the durable base still matches', () => {
    const entry = createNotebookRecoveryEntry({
      content: 'draft',
      baseContent: 'saved',
      baseUpdatedAt: 100,
      revision: 3,
    });

    expect(resolveNotebookRecovery('saved', 100, entry)).toEqual({
      kind: 'restore',
      content: 'draft',
    });
  });

  it('requires a choice when both durable and draft diverged from the base', () => {
    const entry = createNotebookRecoveryEntry({
      content: 'local draft',
      baseContent: 'old saved',
      baseUpdatedAt: 100,
      revision: 3,
    });

    expect(resolveNotebookRecovery('remote saved', 200, entry)).toEqual({
      kind: 'diverged',
      durableContent: 'remote saved',
      recoveryContent: 'local draft',
    });
  });

  it('does not restore recovery that is already identical to durable content', () => {
    const entry = createNotebookRecoveryEntry({
      content: 'saved',
      baseContent: 'older',
      baseUpdatedAt: 50,
      revision: 3,
    });

    expect(resolveNotebookRecovery('saved', 100, entry)).toEqual({ kind: 'none' });
  });
});
