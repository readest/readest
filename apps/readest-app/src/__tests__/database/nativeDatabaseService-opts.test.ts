import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoadOptions } from 'tauri-plugin-turso';
import type { DatabaseOpts } from '@/types/database';

// Capture the argument Database.load receives so we can assert opts forwarding.
// The plugin signature is Database.load(pathOrOptions: string | LoadOptions) — a
// single argument that's either a path string (no opts) or a LoadOptions object
// (path embedded in the object).
vi.mock('tauri-plugin-turso', () => {
  const loadCalls: Array<string | LoadOptions> = [];
  const mockDb = {
    execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
    select: vi.fn(async () => []),
    batch: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return {
    Database: {
      load: vi.fn(async (pathOrOptions: string | LoadOptions) => {
        loadCalls.push(pathOrOptions);
        return mockDb;
      }),
    },
    __loadCalls: loadCalls,
    __mockDb: mockDb,
  };
});

describe('NativeDatabaseService.open forwards opts to tauri-plugin-turso', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('tauri-plugin-turso');
    (mod as unknown as { __loadCalls: unknown[] }).__loadCalls.length = 0;
  });

  it('passes a plain path string when no opts provided (preserves existing behavior)', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    await NativeDatabaseService.open('sqlite:test.db');

    const mod = await import('tauri-plugin-turso');
    const loadCalls = (mod as unknown as { __loadCalls: Array<string | LoadOptions> }).__loadCalls;
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0]).toBe('sqlite:test.db');
  });

  it('translates experimental opts into LoadOptions and forwards as a single object', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    const opts: DatabaseOpts = { experimental: ['index_method'] };
    await NativeDatabaseService.open('sqlite:reedy.db', opts);

    const mod = await import('tauri-plugin-turso');
    const loadCalls = (mod as unknown as { __loadCalls: Array<string | LoadOptions> }).__loadCalls;
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0]).toEqual({
      path: 'sqlite:reedy.db',
      experimental: ['index_method'],
    });
  });

  it('passes a plain path string when opts has no experimental and no encryption', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    // Fields like `readonly`/`timeout` exist in DatabaseOpts but aren't supported by
    // the native plugin's LoadOptions, so the translator should skip them and
    // fall back to a bare path string.
    const opts: DatabaseOpts = { readonly: true, timeout: 5000 };
    await NativeDatabaseService.open('sqlite:plain.db', opts);

    const mod = await import('tauri-plugin-turso');
    const loadCalls = (mod as unknown as { __loadCalls: Array<string | LoadOptions> }).__loadCalls;
    expect(loadCalls[0]).toBe('sqlite:plain.db');
  });

  it('passes a plain path string when experimental is an empty array', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    await NativeDatabaseService.open('sqlite:empty-exp.db', { experimental: [] });

    const mod = await import('tauri-plugin-turso');
    const loadCalls = (mod as unknown as { __loadCalls: Array<string | LoadOptions> }).__loadCalls;
    expect(loadCalls[0]).toBe('sqlite:empty-exp.db');
  });
});
