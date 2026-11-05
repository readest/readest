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

const appService = { saveLibraryBooks: vi.fn(async () => {}) } as unknown as AppService;

describe('syncAllAbsServers data flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.client.getLibraries.mockReset().mockResolvedValue([]);
    h.client.getLibraryItems.mockReset().mockResolvedValue([]);
    h.client.getMe.mockReset().mockResolvedValue({ mediaProgress: [] });
  });

  it('records a pass as a working book pull', async () => {
    await syncAllAbsServers(appService);

    const total = readFlowState().totals['audiobookshelf:pull:books'];
    expect(total?.lastSuccessAt).toBeGreaterThan(0);
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
