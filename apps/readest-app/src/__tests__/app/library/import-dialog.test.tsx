import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportDialog } from '@/app/library/components/ImportDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

vi.mock('@/components/Dialog', () => ({
  default: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

beforeEach(() => {
  useEnvMock.mockReturnValue({ appService: { isOnlineCatalogsAccessible: true } });
});

afterEach(() => {
  cleanup();
  useEnvMock.mockReset();
});

describe('ImportDialog', () => {
  it('renders the always-available actions as fully clickable cards', () => {
    const events: string[] = [];
    render(
      <ImportDialog
        onClose={() => events.push('close')}
        onImportBooksFromFiles={() => events.push('file')}
        onOpenFeeds={() => events.push('feed')}
        onOpenCatalogManager={() => events.push('catalog')}
      />,
    );

    expect(screen.getByRole('region', { name: 'Import Books' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /From Local File/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /From Feed URL/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Online Library/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /From Directory/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /From Web URL/ })).toBeNull();

    fireEvent.click(screen.getByText('Choose one or more books from your device'));

    expect(events).toEqual(['close', 'file']);

    fireEvent.click(screen.getByText('Paste an RSS, Atom, or JSON Feed URL to subscribe.'));

    expect(events).toEqual(['close', 'file', 'close', 'feed']);
  });

  it('adds platform-dependent actions when their callbacks are available', () => {
    const onClose = vi.fn();
    const onImportBooksFromDirectory = vi.fn();
    const onImportBookFromUrl = vi.fn();
    render(
      <ImportDialog
        onClose={onClose}
        onImportBooksFromFiles={vi.fn()}
        onImportBooksFromDirectory={onImportBooksFromDirectory}
        onImportBookFromUrl={onImportBookFromUrl}
        onOpenFeeds={vi.fn()}
        onOpenCatalogManager={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Import supported books from a folder'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImportBooksFromDirectory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Import a book using a direct download link'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onImportBookFromUrl).toHaveBeenCalledTimes(1);
  });

  it('uses the OPDS label when curated online catalogs are unavailable', () => {
    useEnvMock.mockReturnValue({ appService: { isOnlineCatalogsAccessible: false } });
    render(
      <ImportDialog
        onClose={vi.fn()}
        onImportBooksFromFiles={vi.fn()}
        onOpenFeeds={vi.fn()}
        onOpenCatalogManager={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /OPDS Catalogs/ })).toBeTruthy();
    expect(screen.getByText('Browse and download books from online catalogs')).toBeTruthy();
  });
});
