'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FaSearch } from 'react-icons/fa';

import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useFileSelector } from '@/hooks/useFileSelector';
import { navigateToReader } from '@/utils/nav';
import { formatAuthors } from '@/utils/book';
import { type SelectedFile } from '@/hooks/useFileSelector';
import { isTauriAppPlatform } from '@/services/environment';
import WindowButtons from '@/components/WindowButtons';
import AppTitleBar from '@/components/AppTitleBar';

const HOME_PREVIEW_LIMIT = 4;

export default function HomePage() {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const { safeAreaInsets: insets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { library, setLibrary } = useLibraryStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { selectFiles } = useFileSelector(appService, _);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const titlebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const initHome = async () => {
      const service = await envConfig.getAppService();
      const loadedSettings = await service.loadSettings();
      if (!mounted) return;
      setSettings(loadedSettings);

      if (token && user) {
        if (!loadedSettings.keepLogin) {
          loadedSettings.keepLogin = true;
          setSettings(loadedSettings);
          saveSettings(envConfig, loadedSettings);
        }
      } else if (loadedSettings.keepLogin) {
        router.push('/auth');
        return;
      }

      const loadedLibrary = library.length > 0 ? library : await service.loadLibraryBooks();
      if (!mounted) return;
      setLibrary(loadedLibrary);
      setIsLoading(false);
    };
    initHome();
    return () => {
      mounted = false;
    };
  }, [envConfig, library, router, saveSettings, setLibrary, setSettings, token, user]);

  const visibleBooks = useMemo(() => library.filter((book) => !book.deletedAt), [library]);
  const continueBook = useMemo(() => {
    const lastOpenBookId = settings.lastOpenBooks?.[0];
    if (lastOpenBookId) {
      const lastOpenBook = visibleBooks.find((book) => book.hash === lastOpenBookId);
      if (lastOpenBook) return lastOpenBook;
    }
    return visibleBooks[0] ?? null;
  }, [settings.lastOpenBooks, visibleBooks]);
  const recentBooks = useMemo(() => {
    return [...visibleBooks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, HOME_PREVIEW_LIMIT);
  }, [visibleBooks]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredRecentBooks = useMemo(() => {
    if (!normalizedSearchQuery) return recentBooks;
    return recentBooks.filter((book) => {
      const searchableAuthor =
        formatAuthors(book.author, book.primaryLanguage) || book.author || '';
      const searchableText = `${book.title} ${searchableAuthor}`.toLowerCase();
      return searchableText.includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery, recentBooks]);

  const handleContinue = () => {
    if (!continueBook) return;
    navigateToReader(router, [continueBook.hash]);
  };

  const importBooks = async (files: SelectedFile[]) => {
    if (!files.length || !appService) return;
    const service = await envConfig.getAppService();
    const workingLibrary = [...useLibraryStore.getState().library];
    let changed = false;
    for (const selectedFile of files) {
      const file = selectedFile.file || selectedFile.path;
      if (!file) continue;
      const imported = await service.importBook(file, workingLibrary);
      if (!imported) continue;
      changed = true;
    }
    if (!changed) return;
    setLibrary(workingLibrary);
    await service.saveLibraryBooks(workingLibrary);
  };

  const handleImport = async () => {
    const result = await selectFiles({ type: 'books', multiple: true });
    if (result.error || !result.files.length) return;
    await importBooks(result.files);
  };

  if (!appService || !insets || isLoading) {
    return <div className='full-height bg-base-200' />;
  }

  const windowButtonVisible = !!appService?.hasWindowBar;
  const hasSearchQuery = normalizedSearchQuery.length > 0;

  return (
    <main className={clsx('full-height text-base-content overflow-auto', 'bg-base-200')}>
      <AppTitleBar
        headerRef={titlebarRef}
        className='z-20 sm:pr-6'
        style={{
          marginTop: appService?.hasSafeAreaInset
            ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
            : '0px',
        }}
        leftClassName='pl-4'
        leftContent={
          <p className='whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-[var(--citadel-text-muted)]'>
            {_('Citadel Home')}
          </p>
        }
        centerClassName='exclude-title-bar-mousedown relative w-full'
        centerContent={
          <>
            <span className='text-base-content/50 absolute left-0 ps-3'>
              <FaSearch className='h-4 w-4' />
            </span>
            <input
              type='text'
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={_('Search your books...')}
              spellCheck='false'
              className='search-input input bg-base-300/45 placeholder:text-base-content/50 h-9 w-full rounded-full border border-transparent pr-[26%] ps-10 text-sm font-light focus:outline-none focus:ring-0 focus-visible:border-[var(--citadel-line-gold)] focus-visible:shadow-[var(--citadel-border-glow)] sm:h-7 sm:pr-[20%]'
            />
          </>
        }
        rightClassName='exclude-title-bar-mousedown pr-4'
        rightContent={
          <div className='border-base-content/10 bg-base-100/35 flex h-full items-center gap-x-1 rounded-full border px-1 py-1 sm:gap-x-1.5'>
            <Link
              href='/library'
              aria-label={_('Library')}
              title={_('Library')}
              className='btn btn-ghost text-base-content/65 h-8 min-h-8 px-2 text-xs font-medium transition-[opacity,color] hover:text-[var(--citadel-gold)] hover:opacity-100 sm:opacity-80'
            >
              {_('Library')}
            </Link>
            <WindowButtons
              headerRef={titlebarRef}
              showMinimize={windowButtonVisible}
              showMaximize={windowButtonVisible}
              showClose={windowButtonVisible}
            />
          </div>
        }
      />
      <div
        className='px-4 pb-8 pt-4 sm:px-6 sm:pt-6'
        style={{
          paddingLeft: `max(${insets.left}px, 1rem)`,
          paddingRight: `max(${insets.right}px, 1rem)`,
          paddingBottom: `max(${insets.bottom}px, 2rem)`,
        }}
      >
        <section className='mx-auto w-full max-w-[1400px]'>
          <div className='rounded-3xl border border-[var(--citadel-line-gold)] bg-[color-mix(in_srgb,var(--citadel-bg-dark)_74%,theme(colors.base-100)_26%)] p-6 shadow-[var(--citadel-shadow-panel)] sm:p-8'>
            <p className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--citadel-gold)]'>
              {_('Citadel Home')}
            </p>
            <h1 className='text-base-100 mt-3 text-3xl font-semibold sm:text-4xl'>
              {continueBook ? _('Ready to continue reading?') : _('Welcome to Citadel')}
            </h1>
            <p className='mt-2 max-w-2xl text-sm text-[var(--citadel-text-muted)] sm:text-base'>
              {continueBook
                ? _('Pick up your current book, then jump to Library when you want full controls.')
                : _('Choose a book from your library when you are ready, or import one to begin.')}
            </p>
            {continueBook && (
              <div className='bg-base-100/10 mt-5 rounded-2xl border border-[var(--citadel-line-gold)] p-4'>
                <p className='text-base-100 text-sm font-medium'>{continueBook.title}</p>
                <p className='mt-1 line-clamp-1 text-sm text-[var(--citadel-text-muted)]'>
                  {formatAuthors(continueBook.author, continueBook.primaryLanguage) ||
                    _('Unknown author')}
                </p>
              </div>
            )}
            <div className='mt-6 flex flex-wrap gap-3'>
              <button
                className='btn btn-sm border-[var(--citadel-line-gold)] bg-transparent text-[var(--citadel-gold)] hover:bg-[color-mix(in_srgb,var(--citadel-gold)_16%,transparent)]'
                onClick={handleContinue}
                disabled={!continueBook}
              >
                {continueBook ? _('Continue') : _('Choose from Library')}
              </button>
              <button
                className='btn btn-sm btn-ghost border-base-content/20 border'
                onClick={handleImport}
              >
                {_('Import Books')}
              </button>
              {isTauriAppPlatform() && (
                <span className='self-center text-xs text-[var(--citadel-text-muted)]'>
                  {_('Tip: drag and drop books on Library for full management options.')}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className='mx-auto mt-6 w-full max-w-[1400px]'>
          <div className='border-base-content/10 bg-base-100/70 rounded-2xl border p-4 shadow-[var(--citadel-shadow-soft)]'>
            <div className='flex items-center justify-between'>
              <h2 className='text-sm font-semibold uppercase tracking-[0.16em] text-[var(--citadel-gold)]'>
                {hasSearchQuery ? _('Matching your search') : _('Recent in your collection')}
              </h2>
              <Link
                href='/library'
                className='hover:text-base-content text-xs text-[var(--citadel-text-muted)]'
              >
                {_('View full library')}
              </Link>
            </div>
            {filteredRecentBooks.length > 0 ? (
              <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                {filteredRecentBooks.map((book) => (
                  <button
                    key={book.hash}
                    className='border-base-content/10 bg-base-100 rounded-xl border px-3 py-3 text-left transition-colors hover:border-[var(--citadel-line-gold)]'
                    onClick={() => navigateToReader(router, [book.hash])}
                  >
                    <p className='line-clamp-1 text-sm font-medium'>{book.title}</p>
                    <p className='mt-1 line-clamp-1 text-xs text-[var(--citadel-text-muted)]'>
                      {formatAuthors(book.author, book.primaryLanguage) || _('Unknown author')}
                    </p>
                  </button>
                ))}
              </div>
            ) : hasSearchQuery ? (
              <p className='mt-4 text-sm text-[var(--citadel-text-muted)]'>
                {_('No books match this search yet. Try a different title or author.')}
              </p>
            ) : (
              <p className='mt-4 text-sm text-[var(--citadel-text-muted)]'>
                {_('No books yet. Open Library to import and organize your collection.')}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
