import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailView from '@/components/metadata/BookDetailView';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: true,
      metadataDescriptionCollapsed: true,
    },
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock
    return <img {...props} />;
  },
}));

afterEach(() => cleanup());

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'EPUB',
    coverImageUrl: 'https://example.com/cover.jpg',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    downloadedAt: Date.now(),
    uploadedAt: Date.now(),
    ...overrides,
  }) as Book;

const renderView = (extra?: Partial<React.ComponentProps<typeof BookDetailView>>) =>
  render(
    <DropdownProvider>
      <BookDetailView
        book={makeBook()}
        metadata={null}
        fileSize={1024}
        onDelete={vi.fn()}
        onDeleteCloudBackup={vi.fn()}
        onDeleteLocalCopy={vi.fn()}
        {...extra}
      />
    </DropdownProvider>,
  );

describe('BookDetailView delete dropdown layout', () => {
  it('places dropdown-center on the parent dropdown so the menu stays in flow', () => {
    const { container } = renderView();
    const toggle = container.querySelector('button[aria-label="Delete Book Options"]');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);

    // The parent <details> should center its absolutely positioned content.
    const details = container.querySelector('details.dropdown');
    expect(details).toBeTruthy();
    expect(details!.className).toContain('dropdown-center');

    // The inner menu must NOT carry dropdown-center (which would force
    // position: absolute on it and detach the menu from its anchor — the bug
    // reported in https://github.com/readest/readest/issues/3940 where the
    // menu shifted to the right when items were clicked).
    const menu = container.querySelector('.delete-menu');
    expect(menu).toBeTruthy();
    expect(menu!.className).not.toContain('dropdown-center');
    // It should keep position: relative via the !relative override so it
    // anchors against the centered parent.
    expect(menu!.className).toContain('!relative');
  });
});
