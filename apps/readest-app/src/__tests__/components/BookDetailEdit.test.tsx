// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BookDetailEdit from '@/components/metadata/BookDetailEdit';
import type { Book } from '@/types/book';

const { browserFetch, appService } = vi.hoisted(() => ({
  browserFetch: vi.fn(),
  appService: {
    appPlatform: 'tauri',
    writeFile: vi.fn(),
    resolveFilePath: vi.fn(async () => '/cache/cover.png'),
    getCachedImageUrl: vi.fn(async () => 'cached-cover'),
    getImageURL: vi.fn(async () => 'cached-cover'),
  },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService }) }));
vi.mock('@/hooks/useFileSelector', () => ({ useFileSelector: () => ({ selectFiles: vi.fn() }) }));
vi.mock('@/hooks/useDefaultBookshelfCovers', () => ({
  useDefaultBookshelfCovers: () => ({ skeuomorphicCovers: false }),
}));
vi.mock('@/components/BookCover', () => ({ default: () => <span>Cover preview</span> }));
vi.mock('@/components/metadata/CoverSearchDialog', () => ({
  default: ({ onSelect }: { onSelect: (url: string, pageUrl: string) => Promise<void> }) => (
    <button
      onClick={() => void onSelect('https://images.example/cover.png', 'https://example.com/book')}
    >
      Select result
    </button>
  ),
}));
vi.mock('@/services/webBrowser/browserFetch', () => ({ browserFetch }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const show = (locked = false) => {
  const onFieldChange = vi.fn();
  render(
    <BookDetailEdit
      book={{ title: 'Book', author: 'Author' } as Book}
      metadata={{ title: 'Book', author: 'Author', language: 'en' }}
      tags={[]}
      fieldSources={{}}
      lockedFields={{ coverImageUrl: locked }}
      fieldErrors={{}}
      searchLoading={false}
      onFieldChange={onFieldChange}
      onToggleFieldLock={vi.fn()}
      onAutoRetrieve={vi.fn()}
      onLockAll={vi.fn()}
      onUnlockAll={vi.fn()}
      onCancel={vi.fn()}
      onReset={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  return onFieldChange;
};

describe('cover image search in metadata editor', () => {
  it('stages the selected image and clears the previous blob before Save', async () => {
    browserFetch.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }),
    );
    const onFieldChange = show();
    fireEvent.click(screen.getByRole('button', { name: 'Search Book Covers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select result' }));
    await waitFor(() =>
      expect(onFieldChange).toHaveBeenCalledWith('coverImageFile', '/cache/cover.png'),
    );
    expect(browserFetch).toHaveBeenCalledWith('https://images.example/cover.png', {
      headers: { Referer: 'https://example.com/book' },
    });
    expect(onFieldChange).toHaveBeenCalledWith('coverImageBlobUrl', undefined);
    expect(onFieldChange).toHaveBeenCalledWith('coverImageUrl', 'cached-cover');
    expect(appService.writeFile).toHaveBeenCalled();
  });

  it('disables search when the cover is locked', () => {
    show(true);
    expect(
      (screen.getByRole('button', { name: 'Search Book Covers' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
