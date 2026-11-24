import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { transferManager } from '@/services/transferManager';
import { useTransferStore } from '@/store/transferStore';
import { setCachedUserPlan } from '@/services/sync/cloudSyncProvider';

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
  useTransferStore.setState({ transfers: {} });
  useLibraryStore.setState({ getVisibleLibrary: () => [localOnlyBook] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setCachedUserPlan('free');
});

describe('generic provider transfer history', () => {
  it('shows provider, file name and failure without unsupported queue controls', () => {
    withSettings();
    const store = useTransferStore.getState();
    const id = store.addFileTransfer('s3', '/Readest/library.json', 'upload');
    store.setTransferStatus(id, 'failed', 'Offline');
    render(<TransferQueuePanel />);
    expect(screen.getByText('library.json')).not.toBeNull();
    expect(screen.getByText(/S3/)).not.toBeNull();
    expect(screen.getByText('Offline')).not.toBeNull();
    expect(screen.queryByLabelText('Retry')).toBeNull();
    expect(screen.queryByLabelText('Cancel')).toBeNull();
    expect(screen.queryByText('Retry All')).toBeNull();
    fireEvent.click(screen.getByText('Clear Failed'));
    expect(screen.queryByText('library.json')).toBeNull();
  });
});

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

describe('TransferQueuePanel Download All', () => {
  const cloudOnlyBook: Book = {
    ...localOnlyBook,
    hash: 'book-2',
    downloadedAt: null,
    uploadedAt: 1000,
  };

  it.each([
    'webdav',
    'googleDrive',
    's3',
    'onedrive',
    'icloud',
  ] as const)('queues cloud-only books with %s enabled and Readest Cloud off', (provider) => {
    setCachedUserPlan('plus');
    withSettings({ readestCloud: { enabled: false }, [provider]: { enabled: true } });
    useLibraryStore.setState({
      getVisibleLibrary: () => [
        cloudOnlyBook,
        localOnlyBook,
        { ...cloudOnlyBook, downloadedAt: 1000 },
        { ...cloudOnlyBook, hash: 'feed', url: 'feed://subscription' },
      ],
    });
    const queueDownload = vi.spyOn(transferManager, 'queueDownload').mockReturnValue('t-1');

    render(<TransferQueuePanel />);
    fireEvent.click(screen.getByLabelText('Download All'));

    expect(queueDownload).toHaveBeenCalledExactlyOnceWith(cloudOnlyBook, undefined, true);
    expect(screen.queryByLabelText('Upload All')).toBeNull();
  });

  it('is hidden when all providers are disabled', () => {
    withSettings({ readestCloud: { enabled: false } });
    useLibraryStore.setState({ getVisibleLibrary: () => [cloudOnlyBook] });
    render(<TransferQueuePanel />);
    expect(screen.queryByLabelText('Download All')).toBeNull();
  });

  it('is hidden when the only file provider is paused', () => {
    withSettings({
      readestCloud: { enabled: false },
      s3: { enabled: true },
    } as Partial<SystemSettings>);
    useLibraryStore.setState({ getVisibleLibrary: () => [cloudOnlyBook] });
    render(<TransferQueuePanel />);
    expect(screen.queryByLabelText('Download All')).toBeNull();
  });

  // A library-wide download would otherwise toast "Book downloaded" once per
  // book for the whole run (#6418); the panel itself shows the progress.
  it('queues the downloads in the background', () => {
    withSettings();
    useLibraryStore.setState({ getVisibleLibrary: () => [cloudOnlyBook] });
    const queueDownload = vi.spyOn(transferManager, 'queueDownload').mockReturnValue('t-1');

    render(<TransferQueuePanel />);
    fireEvent.click(screen.getByLabelText('Download All'));

    expect(queueDownload).toHaveBeenCalledWith(cloudOnlyBook, undefined, true);
  });
});
