import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordExchange,
  getConnectorHealth,
  getConnectorSyncStatus,
  getConnectorTotals,
  readFlowState,
  recordConnectionCheck,
  recordFlow,
  resetFlowLog,
  subscribeFlowState,
} from '@/services/sync/dataFlow/log';

describe('data flow log', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds every entry to the totals for its connector and direction', () => {
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 3 });
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 2 });
    recordFlow({ connector: 'kosync', direction: 'pull', kind: 'progress', count: 1 });

    const state = readFlowState();
    expect(getConnectorTotals(state, 'readwise')).toEqual({ pulled: 0, pushed: 5 });
    expect(getConnectorTotals(state, 'kosync')).toEqual({ pulled: 1, pushed: 0 });
  });

  it('merges repeated page-turn pushes of one book into one log row', () => {
    const entry = {
      connector: 'kosync',
      direction: 'push',
      kind: 'progress',
      count: 1,
      bookTitle: 'Dune',
    } as const;
    recordFlow(entry);
    vi.advanceTimersByTime(60_000);
    recordFlow(entry);

    const { entries } = readFlowState();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ count: 2, at: Date.now() });
  });

  it('starts a new row for a different book', () => {
    const entry = { connector: 'kosync', direction: 'push', kind: 'progress', count: 1 } as const;
    recordFlow({ ...entry, bookTitle: 'Dune' });
    recordFlow({ ...entry, bookTitle: 'Emma' });

    expect(readFlowState().entries.map((e) => e.bookTitle)).toEqual(['Emma', 'Dune']);
  });

  it('starts a new row once the last one is old', () => {
    const entry = { connector: 'kosync', direction: 'push', kind: 'progress', count: 1 } as const;
    recordFlow(entry);
    vi.advanceTimersByTime(60 * 60 * 1000);
    recordFlow(entry);

    expect(readFlowState().entries).toHaveLength(2);
  });

  it('keeps a sync that moved nothing out of the history but counts it as working', () => {
    recordFlow({ connector: 'notion', direction: 'push', kind: 'notes', error: 'HTTP 500' });
    vi.advanceTimersByTime(1000);
    recordFlow({ connector: 'notion', direction: 'push', kind: 'notes', count: 0 });

    const state = readFlowState();
    expect(state.entries).toHaveLength(1);
    expect(getConnectorSyncStatus(state, 'notion').status).toBe('ok');
  });

  it('reports the last failure until a later sync succeeds', () => {
    const entry = { connector: 'hardcover', direction: 'push', kind: 'progress' } as const;
    recordFlow({ ...entry, count: 1 });
    vi.advanceTimersByTime(1000);
    recordFlow({ ...entry, error: 'Invalid token' });

    const failed = getConnectorSyncStatus(readFlowState(), 'hardcover');
    expect(failed).toMatchObject({ status: 'failed', error: 'Invalid token' });

    vi.advanceTimersByTime(1000);
    recordFlow({ ...entry, count: 1 });
    expect(getConnectorSyncStatus(readFlowState(), 'hardcover').status).toBe('ok');
  });

  it('does not let a working pull hide a push that keeps failing', () => {
    const entry = { connector: 'kosync', kind: 'progress' } as const;
    recordFlow({ ...entry, direction: 'push', error: 'HTTP 403' });
    vi.advanceTimersByTime(1000);
    recordFlow({ ...entry, direction: 'pull', count: 1 });

    expect(getConnectorSyncStatus(readFlowState(), 'kosync')).toMatchObject({
      status: 'failed',
      error: 'HTTP 403',
    });
  });

  it('does not count a failed sync as moved data', () => {
    recordFlow({
      connector: 'kosync',
      direction: 'push',
      kind: 'progress',
      count: 1,
      error: 'HTTP 502',
    });

    expect(getConnectorTotals(readFlowState(), 'kosync').pushed).toBe(0);
    expect(readFlowState().entries[0]).toMatchObject({ error: 'HTTP 502' });
  });

  it('says idle for a connector that has not synced yet', () => {
    expect(getConnectorSyncStatus(readFlowState(), 's3').status).toBe('idle');
  });

  it('caps the history, newest first, without losing the totals', () => {
    for (let i = 0; i < 350; i++) {
      recordFlow({
        connector: 'readwise',
        direction: 'push',
        kind: 'notes',
        count: 1,
        bookTitle: `Book ${i}`,
      });
    }

    const state = readFlowState();
    expect(state.entries).toHaveLength(300);
    expect(state.entries[0]?.bookTitle).toBe('Book 349');
    expect(getConnectorTotals(state, 'readwise').pushed).toBe(350);
  });

  it('stores connection checks apart from sync results', () => {
    recordConnectionCheck('kosync', { ok: false, message: 'Invalid credentials.' });

    const state = readFlowState();
    expect(state.checks.kosync).toMatchObject({ ok: false, at: Date.now() });
    expect(getConnectorSyncStatus(state, 'kosync').status).toBe('idle');
  });

  it('needs attention when either the check or the last sync failed', () => {
    const entry = { connector: 'kosync', direction: 'push', kind: 'progress' } as const;
    recordConnectionCheck('kosync', { ok: true });
    expect(getConnectorHealth(readFlowState(), 'kosync')).toBe('ok');

    recordFlow({ ...entry, error: 'HTTP 403' });
    expect(getConnectorHealth(readFlowState(), 'kosync')).toBe('failed');

    vi.advanceTimersByTime(1000);
    recordFlow({ ...entry, count: 1 });
    recordConnectionCheck('kosync', { ok: false, message: 'Offline' });
    expect(getConnectorHealth(readFlowState(), 'kosync')).toBe('failed');
  });

  it('blames only the direction that failed', () => {
    const entry = { connector: 'kosync', kind: 'progress' } as const;
    recordConnectionCheck('kosync', { ok: true });
    recordFlow({ ...entry, direction: 'pull', count: 1 });
    recordFlow({ ...entry, direction: 'push', error: 'HTTP 500' });

    const state = readFlowState();
    expect(getConnectorHealth(state, 'kosync', 'push')).toBe('failed');
    expect(getConnectorHealth(state, 'kosync', 'pull')).toBe('ok');
    expect(getConnectorHealth(state, 'kosync')).toBe('failed');
  });

  it('blames both directions when the connection check fails', () => {
    recordConnectionCheck('kosync', { ok: false, message: 'Offline' });

    expect(getConnectorHealth(readFlowState(), 'kosync', 'pull')).toBe('failed');
    expect(getConnectorHealth(readFlowState(), 'kosync', 'push')).toBe('failed');
  });

  it('says unknown before anything has been tried', () => {
    expect(getConnectorHealth(readFlowState(), 'kosync')).toBe('unknown');
  });

  it('notifies subscribers and returns the same snapshot until something changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlowState(listener);
    const before = readFlowState();
    expect(readFlowState()).toBe(before);

    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(readFlowState()).not.toBe(before);
    unsubscribe();
  });

  it('picks up what another window wrote', () => {
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 1 });
    const listener = vi.fn();
    const unsubscribe = subscribeFlowState(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'readest-data-flow' }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('resets counts and history but keeps the last connection checks', () => {
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 5 });
    recordConnectionCheck('readwise', { ok: true });
    const listener = vi.fn();
    const unsubscribe = subscribeFlowState(listener);

    resetFlowLog();

    const state = readFlowState();
    expect(state.totals).toEqual({});
    expect(state.entries).toEqual([]);
    expect(state.checks.readwise?.ok).toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('starts empty from unreadable stored data', () => {
    localStorage.setItem('readest-data-flow', '{not json');

    expect(readFlowState().entries).toEqual([]);
    recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 1 });
    expect(readFlowState().entries).toHaveLength(1);
  });

  it('never lets a storage failure reach a sync', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() =>
      recordFlow({ connector: 'readwise', direction: 'push', kind: 'notes', count: 1 }),
    ).not.toThrow();
    spy.mockRestore();
  });

  describe('recordExchange', () => {
    const notes = { connector: 'grimmory', kind: 'notes', bookTitle: 'Dune' } as const;

    it('records what went each way', () => {
      recordExchange(notes, { pushed: 2, pulled: 1 });

      const { totals } = readFlowState();
      expect(totals['grimmory:push:notes']?.count).toBe(2);
      expect(totals['grimmory:pull:notes']?.count).toBe(1);
    });

    it('records nothing for a book the server does not have, as no exchange ran', () => {
      recordExchange(notes, { pushed: 0, pulled: 0, unmatched: true });

      expect(readFlowState().totals).toEqual({});
    });

    it('keeps what moved before a later phase found the book unmatched', () => {
      recordExchange(notes, { pushed: 2, pulled: 0, unmatched: true });

      expect(readFlowState().totals['grimmory:push:notes']?.count).toBe(2);
    });

    it('keeps what moved before a failure and flags both sides', () => {
      recordExchange(notes, { pushed: 2, pulled: 1 }, 'HTTP 503');

      const state = readFlowState();
      expect(state.totals['grimmory:push:notes']?.count).toBe(2);
      expect(state.totals['grimmory:pull:notes']?.count).toBe(1);
      expect(getConnectorSyncStatus(state, 'grimmory', 'push').status).toBe('failed');
      expect(getConnectorSyncStatus(state, 'grimmory', 'pull').status).toBe('failed');
    });
  });
});
