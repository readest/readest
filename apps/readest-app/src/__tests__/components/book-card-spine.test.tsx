import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));
vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: ({ showSpine }: { showSpine?: boolean }) => <div data-show-spine={!!showSpine} />,
}));

import BookCard from '@/app/reader/components/sidebar/BookCard';
import { DEFAULT_BOOKSHELF_ID, defaultBookshelves } from '@/services/bookshelves/definitions';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { hlcPack } from '@/libs/crdt';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

const STAMP = hlcPack(1_700_000_000_000, 0, 'dev');

const withSkeuomorphicDefaultShelf = (
  skeuomorphicCovers: boolean,
  librarySkeuomorphicCovers: boolean,
): SystemSettings =>
  ({
    ...DEFAULT_SYSTEM_SETTINGS,
    librarySkeuomorphicCovers,
    bookshelves: {
      rows: {
        [DEFAULT_BOOKSHELF_ID]: {
          user_id: '',
          kind: 'bookshelf',
          replica_id: DEFAULT_BOOKSHELF_ID,
          fields_jsonb: {
            definition: {
              v: {
                ...defaultBookshelves({}).find((s) => s.id === DEFAULT_BOOKSHELF_ID)!,
                skeuomorphicCovers,
              },
              t: STAMP,
              s: 'dev',
            },
          },
          deleted_at_ts: null,
          updated_at_ts: STAMP,
          reincarnation: null,
          manifest_jsonb: null,
          schema_version: 1,
        },
      },
    },
  }) as SystemSettings;

const book = { hash: 'abc123', title: 'Test Book', author: 'Test Author' } as Book;

afterEach(() => cleanup());

describe('reader sidebar BookCard spine', () => {
  it('follows the Default shelf rather than the frozen legacy Theme preference', () => {
    useSettingsStore.setState({ settings: withSkeuomorphicDefaultShelf(true, false) });
    const { container } = render(<BookCard book={book} />);
    expect(container.querySelector('[data-show-spine]')?.getAttribute('data-show-spine')).toBe(
      'true',
    );

    act(() => useSettingsStore.setState({ settings: withSkeuomorphicDefaultShelf(false, true) }));
    expect(container.querySelector('[data-show-spine]')?.getAttribute('data-show-spine')).toBe(
      'false',
    );
  });
});
