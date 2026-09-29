import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

const { default: TransferQueuePanel } = await import('@/app/library/components/TransferQueuePanel');

const localOnlyBook: Book = {
  hash: 'book-1',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  downloadedAt: 1000,
};

const withSettings = (overrides: Partial<SystemSettings> = {}) =>
  useSettingsStore.setState({ settings: { version: 1, ...overrides } as SystemSettings });

beforeEach(() => {
  useLibraryStore.setState({ getVisibleLibrary: () => [localOnlyBook] });
});

afterEach(cleanup);

describe('TransferQueuePanel Upload All', () => {
  it('is offered while Readest Cloud and Books sync are on', () => {
    withSettings();
    render(<TransferQueuePanel />);
    expect(screen.queryByLabelText('Upload All')).not.toBeNull();
  });

  // Uploads made with Books sync off never get a `books` row, so no other
  // device could list them.
  it('is hidden while Books sync is off', () => {
    withSettings({ syncCategories: { book: false } } as Partial<SystemSettings>);
    render(<TransferQueuePanel />);
    expect(screen.queryByLabelText('Upload All')).toBeNull();
  });
});
