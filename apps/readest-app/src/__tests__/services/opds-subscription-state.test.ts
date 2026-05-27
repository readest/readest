import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadSubscriptionState,
  saveSubscriptionState,
  deleteSubscriptionState,
  pruneKnownEntryIds,
  emptyState,
} from '@/services/opds/subscriptionState';
import { MAX_KNOWN_ENTRIES, OPDS_SUBSCRIPTIONS_DIR } from '@/services/opds/types';
import type { OPDSSubscriptionState } from '@/services/opds/types';
import type { AppService } from '@/types/system';

const createMockAppService = () =>
  ({
    exists: vi.fn(async () => false),
    readFile: vi.fn(async () => {
      throw new Error('File not found');
    }),
    writeFile: vi.fn(async () => {}),
    createDir: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    resolveFilePath: vi.fn(async (path: string) => path),
  }) as unknown as AppService;

describe('OPDS subscription state', () => {
  let appService: AppService;

  beforeEach(() => {
    appService = createMockAppService();
  });

  describe('emptyState', () => {
    it('creates an empty state with the given catalogId', () => {
      const state = emptyState('cat-1');
      expect(state).toEqual({
        catalogId: 'cat-1',
        lastCheckedAt: 0,
        knownEntryIds: [],
        failedEntries: [],
      });
    });
  });

  describe('loadSubscriptionState', () => {
    it('returns empty state when file does not exist', async () => {
      (appService.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const state = await loadSubscriptionState(appService, 'cat-1');
      expect(state).toEqual(emptyState('cat-1'));
    });

    it('loads and parses existing state file', async () => {
      const saved: OPDSSubscriptionState = {
        catalogId: 'cat-1',
        lastCheckedAt: 1000,
        knownEntryIds: ['urn:a', 'urn:b'],
        failedEntries: [],
      };
      (appService.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (appService.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(saved));
      const state = await loadSubscriptionState(appService, 'cat-1');
      expect(state.knownEntryIds).toEqual(['urn:a', 'urn:b']);
      expect(state.lastCheckedAt).toBe(1000);
    });

    it('returns empty state on corrupted file', async () => {
      (appService.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (appService.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('not json');
      const state = await loadSubscriptionState(appService, 'cat-1');
      expect(state).toEqual(emptyState('cat-1'));
    });
  });

  describe('saveSubscriptionState', () => {
    it('creates directory and writes state as JSON', async () => {
      const state: OPDSSubscriptionState = {
        catalogId: 'cat-1',
        lastCheckedAt: 1000,
        knownEntryIds: ['urn:a'],
        failedEntries: [],
      };
      await saveSubscriptionState(appService, state);
      expect(appService.createDir).toHaveBeenCalledWith(OPDS_SUBSCRIPTIONS_DIR, 'Data', true);
      expect(appService.writeFile).toHaveBeenCalledWith(
        `${OPDS_SUBSCRIPTIONS_DIR}/cat-1.json`,
        'Data',
        JSON.stringify(state, null, 2),
      );
    });
  });

  describe('deleteSubscriptionState', () => {
    it('deletes the state file', async () => {
      await deleteSubscriptionState(appService, 'cat-1');
      expect(appService.deleteFile).toHaveBeenCalledWith(
        `${OPDS_SUBSCRIPTIONS_DIR}/cat-1.json`,
        'Data',
      );
    });

    it('does not throw if file does not exist', async () => {
      (appService.deleteFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      await expect(deleteSubscriptionState(appService, 'cat-1')).resolves.toBeUndefined();
    });
  });

  describe('pruneKnownEntryIds', () => {
    it('keeps all entries when under limit', () => {
      const ids = ['a', 'b', 'c'];
      expect(pruneKnownEntryIds(ids)).toEqual(['a', 'b', 'c']);
    });

    it('trims oldest entries when over limit', () => {
      const ids = Array.from({ length: MAX_KNOWN_ENTRIES + 100 }, (_, i) => `id-${i}`);
      const pruned = pruneKnownEntryIds(ids);
      expect(pruned.length).toBe(MAX_KNOWN_ENTRIES);
      expect(pruned[pruned.length - 1]).toBe(`id-${MAX_KNOWN_ENTRIES + 99}`);
      expect(pruned[0]).toBe('id-100');
    });
  });
});
