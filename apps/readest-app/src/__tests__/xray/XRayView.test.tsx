import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import XRayView from '@/app/reader/components/notebook/XRayView';
import type { XRayProgressUpdate, XRayProgressUpdateResult } from '@/services/ai/xray/XRayService';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getStatus: vi.fn(),
  updateForProgress: vi.fn<(update: XRayProgressUpdate) => Promise<XRayProgressUpdateResult>>(),
  goTo: vi.fn(),
  currentCfi: 'epubcfi(/6/2!/4/2/1:20)',
  appService: { appPlatform: 'tauri' },
  aiSettings: {
    enabled: true,
    provider: 'ollama',
    indexingMode: 'on-demand',
    reedy: { enabled: true },
  },
  translate: (value: string, options: Record<string, string | number> = {}) =>
    value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options[key] ?? key)),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => mocks.translate,
}));

vi.mock('@/utils/book', () => ({
  formatTitle: (value: string) => value,
  getContributorNames: () => [],
}));

vi.mock('@/services/ai/xray/XRayService', () => ({
  getXRayService: () =>
    Promise.resolve({
      getSnapshot: mocks.getSnapshot,
      getStatus: mocks.getStatus,
      updateForProgress: mocks.updateForProgress,
    }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({
      booksData: {
        booka: {
          bookDoc: {
            metadata: { title: 'Book A', author: 'Author', language: 'en' },
          },
        },
      },
    }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: mocks.currentCfi }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({ getView: () => ({ goTo: mocks.goTo }) }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: {
        aiSettings: mocks.aiSettings,
      },
    }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { on: vi.fn(), off: vi.fn(), dispatch: vi.fn() },
}));

describe('XRayView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentCfi = 'epubcfi(/6/2!/4/2/1:20)';
    mocks.aiSettings = {
      ...mocks.aiSettings,
      enabled: true,
      provider: 'ollama',
      reedy: { enabled: true },
    };
    mocks.getStatus.mockResolvedValue({
      kind: 'ready',
      fingerprint: { bookHash: 'booka', contentHash: 'index-1' },
      maxPositionIndex: 1,
    });
    mocks.getSnapshot.mockResolvedValue({
      fingerprint: { bookHash: 'booka', contentHash: 'index-1' },
      entities: [
        {
          name: 'Alice',
          type: 'character',
          aliases: ['Al'],
          description: 'A determined investigator.',
          facts: [],
          evidence: [],
        },
      ],
      relationships: [],
      events: [],
      claims: [],
      maxPositionIndex: 1,
      updatedAt: 1_000,
    });
  });

  it('keeps the bounded entity explorer open while reading forward', async () => {
    const rendered = render(<XRayView bookKey='booka-view' />);

    const entity = await screen.findByText('Alice');
    expect(screen.getByText('A determined investigator.')).toBeTruthy();
    expect(screen.getByText('Read through position 2')).toBeTruthy();

    const card = entity.closest('details');
    expect(card).not.toBeNull();
    card?.setAttribute('open', '');
    mocks.getSnapshot.mockReturnValueOnce(new Promise(() => {}));
    mocks.currentCfi = 'epubcfi(/6/2!/4/2/1:30)';
    rendered.rerender(<XRayView bookKey='booka-view' />);

    expect(screen.queryByText('Alice')).toBe(entity);
    expect(card?.isConnected).toBe(true);
    expect(card?.open).toBe(true);
    expect(screen.queryByLabelText('Loading X-Ray')).toBeNull();
    await waitFor(() =>
      expect(mocks.getSnapshot).toHaveBeenLastCalledWith('booka', mocks.currentCfi),
    );
  });

  it('does not open X-Ray services when Reedy is disabled', async () => {
    mocks.aiSettings.reedy.enabled = false;
    const { container } = render(<XRayView bookKey='booka-view' />);

    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it('clears a later snapshot when loading an earlier bound fails', async () => {
    const rendered = render(<XRayView bookKey='booka-view' />);
    expect(await screen.findByText('Alice')).toBeTruthy();

    mocks.currentCfi = 'epubcfi(/6/2!/4/2/1:10)';
    mocks.getSnapshot.mockRejectedValue(new Error('Reedy index changed'));
    rendered.rerender(<XRayView bookKey='booka-view' />);

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to load X-Ray');
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('moves between explorer tabs with arrow keys', async () => {
    render(<XRayView bookKey='booka-view' />);
    const entities = await screen.findByRole('tab', { name: 'Entities 1' });

    entities.focus();
    expect(document.activeElement).toBe(entities);
    fireEvent.keyDown(entities, { key: 'ArrowRight' });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Timeline 0' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Timeline 0' })),
    );
  });

  it.each([
    'closing the panel',
    'disabling AI',
    'changing providers',
  ])('cancels manual extraction when %s', async (action) => {
    mocks.updateForProgress.mockReturnValue(new Promise(() => {}));
    const rendered = render(<XRayView bookKey='booka-view' />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Update X-Ray' }));
    await waitFor(() => expect(mocks.updateForProgress).toHaveBeenCalledTimes(1));
    const { signal } = mocks.updateForProgress.mock.calls[0]![0];
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    if (action === 'closing the panel') {
      rendered.unmount();
    } else {
      mocks.aiSettings = {
        ...mocks.aiSettings,
        enabled: action !== 'disabling AI',
        provider: action === 'changing providers' ? 'openrouter' : 'ollama',
      };
      rendered.rerender(<XRayView bookKey='booka-view' />);
    }

    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('Alice')).toBeNull();
  });
});
