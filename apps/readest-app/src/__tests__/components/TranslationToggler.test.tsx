// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TranslationToggler from '@/app/reader/components/TranslationToggler';
import { saveViewSettings } from '@/helpers/settings';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

let book: { format: string; primaryLanguage: string } | null = null;
let viewSettings: { translationEnabled: boolean; translateTargetLang: string };
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ book }) })),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => viewSettings,
    setViewSettings: vi.fn(),
    setHoveredBookKey: vi.fn(),
  }),
}));

const renderToggler = (
  bookProps: { format: string; primaryLanguage: string },
  translationEnabled: boolean,
) => {
  book = bookProps;
  viewSettings = { translationEnabled, translateTargetLang: 'en' };
  return render(<TranslationToggler bookKey='book-1' />);
};

afterEach(() => {
  cleanup();
  vi.mocked(saveViewSettings).mockClear();
});

describe('TranslationToggler (#8044)', () => {
  it.each([
    ['a PDF', { format: 'PDF', primaryLanguage: 'fr' }],
    ['a book with no language', { format: 'EPUB', primaryLanguage: 'und' }],
    ['a book already in the target language', { format: 'EPUB', primaryLanguage: 'en' }],
  ])('leaves the header for %s, which it cannot translate', (_name, bookProps) => {
    renderToggler(bookProps, false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays while translation is on, so it can still be turned off', () => {
    renderToggler({ format: 'EPUB', primaryLanguage: 'en' }, true);
    fireEvent.click(screen.getByRole('button'));
    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'book-1',
      'translationEnabled',
      false,
      true,
      false,
    );
  });

  it('is shown for a book it can translate', () => {
    renderToggler({ format: 'EPUB', primaryLanguage: 'fr' }, false);
    expect(screen.getByRole('button', { name: 'Enable Translation' })).toBeTruthy();
  });
});
