import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { defaultBookshelves } from '@/services/bookshelves/definitions';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import { HlcGenerator } from '@/libs/crdt';
import type { Book, BooksGroup } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS as partialSettings } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
const DEFAULT_SYSTEM_SETTINGS = partialSettings as SystemSettings;
import Bookshelf from '@/app/library/components/Bookshelf';
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  env: {},
  servers: [],
  translate: (s: string) => s,
  open: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.params,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mocks.env, appService: null }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => mocks.translate }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/library/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: mocks.open }),
}));
vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: () => mocks.servers,
  isAbsBookOrphaned: () => false,
}));
vi.mock('@/app/library/components/ShareBookDialog', () => ({ default: () => null }));
vi.mock('@/app/library/components/BookshelfItem', () => ({
  default: ({
    item,
    toggleSelection,
    itemSelected,
  }: {
    item: Book | BooksGroup;
    toggleSelection: (id: string) => void;
    itemSelected: boolean;
  }) => (
    <button
      aria-pressed={itemSelected}
      onClick={() => toggleSelection('hash' in item ? item.hash : item.id)}
    >
      {'hash' in item ? item.title : item.name}
    </button>
  ),
}));
vi.mock('@/app/library/components/SelectModeActions', () => ({ default: () => null }));
const books: Book[] = Array.from({ length: 20 }, (_, index) => ({
  hash: `${index}`,
  title: `Book ${index}`,
  author: 'Writer',
  format: 'EPUB',
  createdAt: index,
  updatedAt: index,
  progress: [1, 100],
}));
const noop = () => {};
const props = {
  libraryBooks: books,
  isSelectMode: true,
  isSelectAll: false,
  isSelectNone: false,
  onScrollerRef: noop,
  handleImportBooks: noop,
  handleBookDownload: async () => true,
  handleBookUpload: async () => true,
  handleBookDelete: async () => true,
  handleBookPurge: async () => true,
  handleSetSelectMode: noop,
  handleShowDetailsBook: noop,
  handleLibraryNavigation: noop,
  handlePushLibrary: async () => {},
  booksTransferProgress: {},
  contentSearch: null,
  onSearchContents: noop,
};

await import('@/styles/globals.css');
await import('overlayscrollbars/overlayscrollbars.css');
beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryGroupBy: 'none',
      libraryRecentShelfEnabled: false,
      libraryAutoColumns: true,
    },
  });
  useLibraryStore.setState({ library: books, selectedBooks: new Set() });
});
afterEach(cleanup);
describe('library scrollbar integration in Chromium', () => {
  for (const empty of [false, true]) {
    it(`keeps import reachable with a ${empty ? 'hidden empty shelf' : 'full grid row'}`, async () => {
      const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
      const clock = new HlcGenerator('test');
      const state = applyBookshelfDraft(
        { rows: {} },
        base,
        base.map((s) => ({
          ...s,
          enabled: s.id === 'default',
          filters: empty
            ? {
                type: 'group',
                match: 'all',
                children: [
                  {
                    type: 'rule',
                    field: 'title',
                    kind: 'text',
                    operator: 'equals',
                    value: 'Absent',
                  },
                ],
              }
            : s.filters,
        })),
        { userId: '', deviceId: 'test', next: () => clock.next() },
      ).state;
      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          bookshelves: state,
          libraryAutoColumns: false,
          libraryColumns: 3,
        },
      });
      const { getByRole, container } = render(
        <div style={{ width: 375, height: 900, display: 'flex' }}>
          <Bookshelf {...props} libraryBooks={books.slice(0, 3)} />
        </div>,
      );
      await waitFor(() => {
        const button = getByRole('button', { name: 'Import Books' });
        const row = button.closest('[data-shelf-layout="grid"]');
        if (empty) {
          expect(row).toBeNull();
          expect(container.querySelector('[data-shelf-layout]')).toBeNull();
        } else {
          expect(row).toBeTruthy();
          expect(row!.querySelectorAll('button')).toHaveLength(1);
          expect(row!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
            getByRole('button', { name: 'Book 2' }).getBoundingClientRect().bottom,
          );
        }
        expect(container.querySelectorAll('[aria-label="Import Books"]')).toHaveLength(1);
      });
    });
  }
  for (const layout of ['grid', 'list', 'carousel'] as const) {
    for (const width of [375, 1200]) {
      it(`places the import action after the last ${layout} shelf at ${width}px`, async () => {
        const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
        const clock = new HlcGenerator('test');
        const state = applyBookshelfDraft(
          { rows: {} },
          base,
          base.map((s) => (s.id === 'default' ? { ...s, layout } : s)),
          { userId: '', deviceId: 'test', next: () => clock.next() },
        ).state;
        useSettingsStore.setState({
          settings: {
            ...useSettingsStore.getState().settings,
            bookshelves: state,
            libraryViewMode: layout === 'list' ? 'list' : 'grid',
          },
        });
        const onImport = vi.fn();
        const { getByRole, container } = render(
          <div style={{ width, height: 900, display: 'flex' }}>
            <Bookshelf {...props} libraryBooks={books.slice(0, 2)} handleImportBooks={onImport} />
          </div>,
        );
        await waitFor(() => {
          const button = getByRole('button', { name: 'Import Books' });
          const row = button.closest('[data-shelf-layout]');
          if (layout === 'carousel') {
            expect(row).toBeNull();
            expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(320);
            expect(button.getBoundingClientRect().height).toBe(48);
          } else {
            expect(row?.getAttribute('data-shelf-layout')).toBe(layout);
            if (layout === 'grid') {
              expect(row?.contains(getByRole('button', { name: 'Book 1' }))).toBe(true);
              expect(button.getBoundingClientRect().width).toBeLessThan(width / 2);
            }
          }
          expect(container.querySelectorAll('[aria-label="Import Books"]')).toHaveLength(1);
        });
        const button = getByRole('button', { name: 'Import Books' });
        fireEvent.click(button);
        expect(onImport).toHaveBeenCalledWith(button);
      });
    }
  }
  for (const width of [375, 1200]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`fills the library width at ${width}px in ${dir}`, async () => {
        const { container, queryByRole, getByRole } = render(
          <div dir={dir} style={{ width, height: 600, display: 'flex' }}>
            <Bookshelf {...props} isSelectMode={false} />
          </div>,
        );
        await waitFor(() => {
          const library = container.querySelector<HTMLElement>('[role="main"]')!;
          const viewport = container.querySelector<HTMLElement>(
            '[data-overlayscrollbars-viewport]',
          )!;
          expect(viewport).toBeTruthy();
          const bounds = library.getBoundingClientRect();
          const viewportBounds = viewport.getBoundingClientRect();
          expect(viewportBounds.width).toBeCloseTo(bounds.width, 0);
          expect(viewportBounds.left).toBeCloseTo(bounds.left, 0);
          const measurement = container.querySelector<HTMLElement>(
            '[data-testid="bookshelf-stream"]',
          )!;
          expect(measurement.contains(viewport)).toBe(true);
          expect(getByRole('button', { name: 'Book 19' })).toBeTruthy();
          expect(queryByRole('heading', { name: /^Default/ })).toBeNull();
        });
      });
    }
  }
});
