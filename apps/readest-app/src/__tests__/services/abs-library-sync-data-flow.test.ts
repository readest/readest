import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';

const h = vi.hoisted(() => ({
  client: {
    getLibraries: vi.fn(),
    getLibraryItems: vi.fn(),
    getMe: vi.fn(),
  },
}));

vi.mock('@/services/audiobookshelf/createClient', () => ({ createAbsClient: () => h.client }));
vi.mock('@/store/absServerStore', () => {
  const state = {
    getAvailableServers: () => [{ id: 's1', name: 'Home', url: 'http://abs' }],
    updateServer: vi.fn(),
    saveABSServers: vi.fn(async () => {}),
  };
  return { useABSServerStore: { getState: () => state } };
});

import { syncAllAbsServers } from '@/services/audiobookshelf/librarySync';
import { readFlowState } from '@/services/sync/dataFlow/log';

const appService = {
  saveLibraryBooks: vi.fn(async () => {}),
  exists: vi.fn(async () => true),
} as unknown as AppService;

describe('syncAllAbsServers data flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.client.getLibraries.mockReset().mockResolvedValue([]);
    h.client.getLibraryItems.mockReset().mockResolvedValue([]);
    h.client.getMe.mockReset().mockResolvedValue({ mediaProgress: [] });
  });

  it('counts streaming stubs as no files, though it shows the sync worked', async () => {
    h.client.getLibraries.mockResolvedValue([{ id: 'l1', mediaType: 'book' }]);
    h.client.getLibraryItems.mockResolvedValue([
      {
        id: 'i1',
        mediaType: 'book',
        media: { metadata: { title: 'Dune' }, duration: 3600, numAudioFiles: 3 },
      },
    ]);
    await syncAllAbsServers(appService);
    expect(appService.saveLibraryBooks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Dune' })]),
    );

    const total = readFlowState().totals['audiobookshelf:pull:books'];
    expect(total?.lastSuccessAt).toBeGreaterThan(0);
    expect(total?.count).toBe(0);
  });

  it('records a server that failed', async () => {
    h.client.getLibraries.mockRejectedValue(new Error('Unauthorized'));

    await syncAllAbsServers(appService);

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'audiobookshelf',
      direction: 'pull',
      kind: 'books',
      error: 'Unauthorized',
    });
  });
});
