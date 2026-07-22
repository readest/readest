import { describe, expect, test } from 'vitest';
import { FileSyncError } from '@/services/sync/file/provider';
import type { FileSyncProvider } from '@/services/sync/file/provider';

/**
 * Transport-agnostic semantics every {@link FileSyncProvider} must honor,
 * regardless of whether the backend is path-addressed (WebDAV — one request per
 * op) or id-addressed (Drive — several). The original WebDAV conformance suite
 * baked in wire details (a `content-length` HEAD, a `list` 404 that throws) that
 * Drive cannot satisfy as-is, so the genuinely shared invariants live here and
 * each backend supplies a {@link ProviderScenario} that stages its own wire
 * responses for the abstract situations below.
 */
export interface ProviderScenario {
  makeProvider: () => FileSyncProvider;
  /** Stage the next op so a read / head / delete sees an absent path. */
  stageAbsent: () => void;
  /** Stage the next op so the backend returns an auth failure (HTTP 401). */
  stageAuthFailure: () => void;
}

export const runSemanticContract = (name: string, makeScenario: () => ProviderScenario): void => {
  describe(`${name} — FileSyncProvider semantic contract`, () => {
    test('readText resolves null for an absent path', async () => {
      const s = makeScenario();
      s.stageAbsent();
      expect(await s.makeProvider().readText('/Readest/x.json')).toBeNull();
    });

    test('readBinary resolves null for an absent path', async () => {
      const s = makeScenario();
      s.stageAbsent();
      expect(await s.makeProvider().readBinary('/Readest/x.bin')).toBeNull();
    });

    test('head resolves null for an absent path', async () => {
      const s = makeScenario();
      s.stageAbsent();
      expect(await s.makeProvider().head('/Readest/x')).toBeNull();
    });

    test('readText maps an auth failure to FileSyncError AUTH_FAILED', async () => {
      const s = makeScenario();
      s.stageAuthFailure();
      const err = await s
        .makeProvider()
        .readText('/Readest/x.json')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FileSyncError);
      expect((err as FileSyncError).code).toBe('AUTH_FAILED');
    });

    test('list maps an auth failure to FileSyncError AUTH_FAILED', async () => {
      const s = makeScenario();
      s.stageAuthFailure();
      const err = await s
        .makeProvider()
        .list('/Readest/books')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FileSyncError);
      expect((err as FileSyncError).code).toBe('AUTH_FAILED');
    });

    test('deleteDir treats an absent target as success', async () => {
      const s = makeScenario();
      s.stageAbsent();
      await expect(s.makeProvider().deleteDir('/Readest/books/gone')).resolves.toBeUndefined();
    });
  });
};
