// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { DBBookConfig } from '@/types/records';
import type { BookConfig } from '@/types/book';

const db = vi.hoisted(() => ({
  config: null as DBBookConfig | null,
  writes: [] as DBBookConfig[],
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'test-user' }, token: 'test-token' }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'books') {
        return {
          update: () => ({
            eq: () => ({ eq: () => ({ lt: async () => ({ error: null }) }) }),
          }),
        };
      }
      const write = (rows: DBBookConfig[]) => {
        db.writes.push(...rows);
        db.config = rows[0] ?? null;
        return { select: async () => ({ data: rows, error: null }) };
      };
      return {
        select: () => ({
          or: async () => ({ data: db.config ? [db.config] : [], error: null }),
        }),
        insert: write,
        upsert: write,
      };
    },
  }),
}));

import { POST } from '@/pages/api/sync';

const publish = (config: Partial<BookConfig> = {}) =>
  POST(
    new Request('https://example.com/api/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        configs: [
          {
            bookHash: 'test-book',
            metaHash: 'test-meta',
            ttsPacks: { readest: ['1-a.mp3'] },
            updatedAt: 0,
            ...config,
          },
        ],
      }),
    }) as unknown as NextRequest,
  );

beforeEach(() => {
  db.config = null;
  db.writes = [];
});

describe('pack-only config publication', () => {
  it.each([
    0, 1_000, 50_000,
  ])('unions packs without changing the server position or timestamp (%s)', async (updatedAt) => {
    const server = {
      user_id: 'test-user',
      book_hash: 'test-book',
      meta_hash: 'test-meta',
      location: 'server-cfi',
      xpointer: 'server-xpointer',
      progress: '[80,100]',
      view_settings: '{"referencePageCount":200}',
      tts_packs: '{"webdav":["2-b.mp3"]}',
      updated_at: new Date(updatedAt).toISOString(),
    };
    db.config = server;

    const response = await publish();

    expect(response.status).toBe(200);
    expect(db.writes).toEqual([
      { ...server, tts_packs: '{"webdav":["2-b.mp3"],"readest":["1-a.mp3"]}' },
    ]);
    expect((await response.json()).configs).toEqual(db.writes);

    await publish();
    expect(db.writes).toHaveLength(1);
  });

  it('seeds the pack record when no cloud config exists', async () => {
    const response = await publish();

    expect(response.status).toBe(200);
    expect(db.config).toMatchObject({
      book_hash: 'test-book',
      meta_hash: 'test-meta',
      tts_packs: '{"readest":["1-a.mp3"]}',
    });
    expect(db.config?.location).toBeUndefined();
    expect(db.config?.xpointer).toBeUndefined();
    expect(db.config?.progress).toBeUndefined();
    // Keep the seed visible to since=0 pulls without outranking saved progress.
    expect(Date.parse(db.config?.updated_at ?? '')).toBe(1);
    const progressResponse = await publish({
      location: 'reader-cfi',
      xpointer: 'reader-xpointer',
      progress: [5, 100],
      updatedAt: 42,
    });
    expect(progressResponse.status).toBe(200);
    expect(db.config).toMatchObject({
      location: 'reader-cfi',
      xpointer: 'reader-xpointer',
      progress: '[5,100]',
      tts_packs: '{"readest":["1-a.mp3"]}',
      updated_at: new Date(42).toISOString(),
    });
  });
});
