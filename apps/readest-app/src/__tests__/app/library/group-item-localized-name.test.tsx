import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Book, BooksGroup } from '@/types/book';

/**
 * Group tiles render `BooksGroup.displayName`. For status groups that string is
 * an i18n *key* produced by `createBookGroups`; for series/author/tag/subject
 * groups it is user-authored text. Translating both would rewrite a tag that
 * happens to collide with a UI string, so the tile must key off `localized`.
 */

// Stand-in for a non-English locale.
const FAKE_LOCALE: Record<string, string> = {
  'On hold': 'En pause',
  Reading: 'En cours de lecture',
};

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => FAKE_LOCALE[key] ?? key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasContextMenu: false } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { librarySkeuomorphicCovers: false } }),
}));

vi.mock('@/components/BookCover', () => ({
  default: () => <div data-testid='cover' />,
}));

import GroupItem from '@/app/library/components/GroupItem';

const book = { hash: 'h1', format: 'EPUB', title: 'A Book', updatedAt: 1 } as Book;

const makeGroup = (overrides: Partial<BooksGroup>): BooksGroup => ({
  id: 'g1',
  name: 'abandoned',
  displayName: 'On hold',
  books: [book],
  updatedAt: 1,
  ...overrides,
});

afterEach(cleanup);

describe.each(['grid', 'list'] as const)('GroupItem name in %s mode', (mode) => {
  it('translates a localized status group', () => {
    render(
      <GroupItem
        mode={mode}
        group={makeGroup({ localized: true })}
        isSelectMode={false}
        groupSelected={false}
      />,
    );

    expect(screen.getByText('En pause')).toBeTruthy();
    expect(screen.queryByText('On hold')).toBeNull();
  });

  it('renders a user-authored name verbatim even when it collides with a UI key', () => {
    render(
      <GroupItem
        mode={mode}
        // A tag literally named "On hold" must survive untranslated.
        group={makeGroup({ name: 'On hold', displayName: 'On hold' })}
        isSelectMode={false}
        groupSelected={false}
      />,
    );

    expect(screen.getByText('On hold')).toBeTruthy();
    expect(screen.queryByText('En pause')).toBeNull();
  });

  it('translates the derived reading group', () => {
    render(
      <GroupItem
        mode={mode}
        group={makeGroup({ name: 'reading', displayName: 'Reading', localized: true })}
        isSelectMode={false}
        groupSelected={false}
      />,
    );

    expect(screen.getByText('En cours de lecture')).toBeTruthy();
  });
});
