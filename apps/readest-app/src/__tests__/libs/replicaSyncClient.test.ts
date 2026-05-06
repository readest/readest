import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/access', () => ({
  getAccessToken: vi.fn(async () => 'fake-token'),
}));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://example.test',
}));

import { ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';
import { SyncError } from '@/libs/errors';

const HLC = hlcPack(1_700_000_000_000, 0, 'd') as Hlc;

const sampleRow: ReplicaRow = {
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'r1',
  fields_jsonb: { name: { v: 'Webster', t: HLC, s: 'd' } },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
};

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReplicaSyncClient.push', () => {
  test('POSTs rows to /sync/replicas with bearer token', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [sampleRow] }), { status: 200 }),
    );
    const client = new ReplicaSyncClient();
    const result = await client.push([sampleRow]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://example.test/sync/replicas');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fake-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ rows: [sampleRow] });
    expect(result).toEqual([sampleRow]);
  });

  test('400 / VALIDATION → SyncError VALIDATION', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad', code: 'VALIDATION' }), { status: 400 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({
      name: 'SyncError',
      code: 'VALIDATION',
    });
  });

  test('401 → SyncError AUTH', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauth', code: 'AUTH' }), { status: 401 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({
      code: 'AUTH',
    });
  });

  test('409 / CLOCK_SKEW → SyncError CLOCK_SKEW', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'skew', code: 'CLOCK_SKEW' }), { status: 409 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({ code: 'CLOCK_SKEW' });
  });

  test('413 / batch too large → SyncError VALIDATION', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'batch', code: 'VALIDATION' }), { status: 413 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  test('422 / UNKNOWN_KIND → SyncError UNKNOWN_KIND', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unknown', code: 'UNKNOWN_KIND' }), { status: 422 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({ code: 'UNKNOWN_KIND' });
  });

  test('5xx → SyncError SERVER', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'oops' }), { status: 500 }),
    );
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toMatchObject({ code: 'SERVER' });
  });

  test('network error → SyncError TIMEOUT/SERVER', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new ReplicaSyncClient();
    await expect(client.push([sampleRow])).rejects.toBeInstanceOf(SyncError);
  });

  test('empty rows is a no-op (no fetch call)', async () => {
    const client = new ReplicaSyncClient();
    const result = await client.push([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('ReplicaSyncClient.pull', () => {
  test('GETs with kind + since query params', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [sampleRow] }), { status: 200 }),
    );
    const client = new ReplicaSyncClient();
    const rows = await client.pull('dictionary', HLC);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      `https://example.test/sync/replicas?kind=dictionary&since=${encodeURIComponent(HLC)}`,
    );
    expect(init.method).toBe('GET');
    expect(rows).toEqual([sampleRow]);
  });

  test('GET without since cursor', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    const client = new ReplicaSyncClient();
    await client.pull('dictionary', null);
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://example.test/sync/replicas?kind=dictionary');
  });

  test('404 → empty array (server lacks /api/sync/replicas; old backend)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const client = new ReplicaSyncClient();
    const rows = await client.pull('dictionary', null);
    expect(rows).toEqual([]);
  });
});
