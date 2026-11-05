import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { eventDispatcher } from '@/utils/event';
import { readFlowState } from '@/services/sync/dataFlow/log';

const h = vi.hoisted(() => {
  const book = { hash: 'h1', title: 'Dune', format: 'EPUB' };
  const config = {
    booknotes: [{ id: 'n1', type: 'annotation', text: 'x', updatedAt: 2, cfi: 'c' }],
    location: 'epubcfi(/6/4)',
  };
  const settings: Record<string, unknown> = {
    readwise: { enabled: true, accessToken: 't', includeCoverImage: false },
    notion: { enabled: true, accessToken: 't', databaseId: 'd' },
    hardcover: { enabled: true, accessToken: 't', autoSync: false },
    pagebound: { enabled: true, refreshToken: 'r', autoSync: false },
    obsidian: { enabled: true, folder: '/vault/Readest' },
  };
  const bookData = {
    getConfig: () => config,
    getBookData: () => ({ book, bookDoc: { toc: [] } }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(async () => {}),
  };
  return {
    settings,
    bookData,
    readwisePush: vi.fn(),
    notionSync: vi.fn(),
    hardcoverNotes: vi.fn(),
    hardcoverProgress: vi.fn(),
    pageboundPush: vi.fn(),
    obsidianSync: vi.fn(),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({}) },
    appService: {},
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/settingsStore', () => {
  const state = {
    get settings() {
      return h.settings;
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(async () => {}),
  };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: () => h.bookData }));
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
vi.mock('@/utils/cover', () => ({ getPublicCoverUrl: vi.fn(async () => undefined) }));
vi.mock('@/services/nav', () => ({ findTocItemBS: () => null }));
vi.mock('@/services/readwise', () => ({
  ReadwiseClient: class {
    pushHighlights = h.readwisePush;
  },
}));
vi.mock('@/services/notion', () => ({
  NotionClient: class {
    syncBookNotes = h.notionSync;
  },
  NotionSyncStore: class {
    close = async () => {};
  },
}));
vi.mock('@/services/pagebound', () => ({
  PageboundClient: class {
    pushProgress = h.pageboundPush;
  },
  PageboundBookError: class extends Error {},
}));
vi.mock('@/services/obsidian/vaultSync', () => ({
  syncBookToVault: h.obsidianSync,
  toVaultHighlights: () => [],
}));
vi.mock('@/services/hardcover', () => {
  class HardcoverUnmatchedError extends Error {}
  class HardcoverAuthError extends Error {}
  return {
    HardcoverClient: class {
      syncBookNotes = h.hardcoverNotes;
      pushProgress = h.hardcoverProgress;
    },
    HardcoverSyncMapStore: class {},
    HardcoverAuthError,
    HardcoverUnmatchedError,
    isHardcoverConnected: () => true,
    createHardcoverTokenStore: () => ({}),
  };
});

import { HardcoverUnmatchedError } from '@/services/hardcover';
import { PageboundBookError } from '@/services/pagebound';
import { useHardcoverSync } from '@/app/reader/hooks/useHardcoverSync';
import { useNotionSync } from '@/app/reader/hooks/useNotionSync';
import { useObsidianSync } from '@/app/reader/hooks/useObsidianSync';
import { usePageboundSync } from '@/app/reader/hooks/usePageboundSync';
import { useReadwiseSync } from '@/app/reader/hooks/useReadwiseSync';

const fire = (event: string) =>
  act(async () => {
    await eventDispatcher.dispatch(event, { bookKey: 'k' });
  });

describe('exporters report what they moved', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Readwise: counts the notes it pushed', async () => {
    h.readwisePush.mockResolvedValue({ success: true, sent: 1 });
    renderHook(() => useReadwiseSync('k'));

    await fire('readwise-push-all');

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'readwise',
      direction: 'push',
      kind: 'notes',
      count: 1,
      bookTitle: 'Dune',
    });
  });

  it('Readwise: leaves out notes it did not send, such as deleted ones', async () => {
    h.readwisePush.mockResolvedValue({ success: true, sent: 0 });
    renderHook(() => useReadwiseSync('k'));

    await fire('readwise-push-all');

    expect(readFlowState().entries).toEqual([]);
    expect(readFlowState().totals['readwise:push:notes']?.lastSuccessAt).toBeGreaterThan(0);
  });

  it('Readwise: logs a refused push', async () => {
    h.readwisePush.mockResolvedValue({ success: false, message: 'Bad token' });
    renderHook(() => useReadwiseSync('k'));

    await fire('readwise-push-all');

    expect(readFlowState().entries[0]).toMatchObject({ connector: 'readwise', error: 'Bad token' });
  });

  it('Notion: counts inserted, updated and deleted notes, not skipped ones', async () => {
    h.notionSync.mockResolvedValue({
      success: true,
      inserted: 2,
      updated: 1,
      deleted: 1,
      skipped: 9,
    });
    renderHook(() => useNotionSync('k'));

    await fire('notion-push-all');

    expect(readFlowState().entries[0]).toMatchObject({ connector: 'notion', count: 4 });
  });

  it('Notion: logs a failed push', async () => {
    h.notionSync.mockResolvedValue({ success: false, message: 'Forbidden' });
    renderHook(() => useNotionSync('k'));

    await fire('notion-push-all');

    expect(readFlowState().entries[0]).toMatchObject({ connector: 'notion', error: 'Forbidden' });
  });

  it('Hardcover: counts new and updated notes', async () => {
    h.hardcoverNotes.mockResolvedValue({ link: {}, inserted: 2, updated: 1, skipped: 5 });
    renderHook(() => useHardcoverSync('k'));

    await fire('hardcover-push-notes');

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'hardcover',
      kind: 'notes',
      count: 3,
    });
  });

  it('Hardcover: reports progress pushes', async () => {
    h.hardcoverProgress.mockResolvedValue({});
    renderHook(() => useHardcoverSync('k'));

    await fire('hardcover-push-progress');

    expect(readFlowState().entries[0]).toMatchObject({ connector: 'hardcover', kind: 'progress' });
  });

  it('Hardcover: logs a failed push', async () => {
    h.hardcoverProgress.mockRejectedValue(new Error('Rate limited'));
    renderHook(() => useHardcoverSync('k'));

    await fire('hardcover-push-progress');

    expect(readFlowState().entries[0]).toMatchObject({ error: 'Rate limited' });
  });

  it('Hardcover: a book it cannot match is not a broken sync', async () => {
    h.hardcoverProgress.mockRejectedValue(new HardcoverUnmatchedError('No match'));
    renderHook(() => useHardcoverSync('k'));

    await fire('hardcover-push-progress');

    expect(readFlowState().entries).toEqual([]);
  });

  it('Pagebound: reports progress pushes and failures', async () => {
    h.pageboundPush.mockResolvedValueOnce({});
    renderHook(() => usePageboundSync('k'));
    await fire('pagebound-push-progress');
    expect(readFlowState().entries[0]).toMatchObject({ connector: 'pagebound', kind: 'progress' });

    h.pageboundPush.mockRejectedValueOnce(new Error('Session expired'));
    await fire('pagebound-push-progress');
    expect(readFlowState().entries[0]).toMatchObject({ error: 'Session expired' });
  });

  it('Pagebound: a book it cannot take is not a broken sync', async () => {
    h.pageboundPush.mockRejectedValueOnce(new PageboundBookError('No match'));
    renderHook(() => usePageboundSync('k'));

    await fire('pagebound-push-progress');

    expect(readFlowState().entries).toEqual([]);
  });

  it('Obsidian: counts the highlights it changed in the vault', async () => {
    h.obsidianSync.mockResolvedValue(3);
    renderHook(() => useObsidianSync('k'));

    await fire('obsidian-push-all');

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'obsidian',
      direction: 'push',
      kind: 'notes',
      count: 3,
      bookTitle: 'Dune',
    });
  });

  it('Obsidian: a sync with nothing to change still reads as working', async () => {
    h.obsidianSync.mockResolvedValue(0);
    renderHook(() => useObsidianSync('k'));

    await fire('obsidian-push-all');

    expect(readFlowState().entries).toEqual([]);
    expect(readFlowState().totals['obsidian:push:notes']?.lastSuccessAt).toBeTypeOf('number');
  });

  it('Obsidian: logs a write that failed', async () => {
    h.obsidianSync.mockRejectedValue(new Error('Permission denied'));
    renderHook(() => useObsidianSync('k'));

    await fire('obsidian-push-all');

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'obsidian',
      error: 'Permission denied',
    });
  });
});
