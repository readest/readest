import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import XRayView from '@/app/reader/components/notebook/XRayView';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getStatus: vi.fn(),
  goTo: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { appPlatform: 'tauri' } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (value: string, options: Record<string, string | number> = {}) =>
      value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options[key] ?? key)),
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
  useBookProgress: () => ({ location: 'epubcfi(/6/2!/4/2/1:20)' }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({ getView: () => ({ goTo: mocks.goTo }) }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: {
        aiSettings: { enabled: true, provider: 'ollama', indexingMode: 'on-demand' },
      },
    }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { on: vi.fn(), off: vi.fn(), dispatch: vi.fn() },
}));

describe('XRayView', () => {
  beforeEach(() => {
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

  it('renders the bounded entity explorer', async () => {
    render(<XRayView bookKey='booka-view' />);

    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('A determined investigator.')).toBeTruthy();
    expect(screen.getByText('Read through position 2')).toBeTruthy();
  });
});
