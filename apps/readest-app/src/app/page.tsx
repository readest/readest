'use client';

import clsx from 'clsx';
import Image from 'next/image';
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
import WindowButtons from '@/components/WindowButtons';
import AppTitleBar from '@/components/AppTitleBar';
import BookCover from '@/components/BookCover';

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

  const hasCoverImage = (book: (typeof visibleBooks)[number] | null) =>
    !!(book?.metadata?.coverImageUrl || book?.coverImageUrl);
  const continueProgressPercent = useMemo(() => {
    const progress = continueBook?.progress;
    if (typeof progress !== 'number' || progress <= 0) return null;
    const normalized = progress <= 1 ? progress * 100 : progress;
    return Math.max(0, Math.min(100, Math.round(normalized)));
  }, [continueBook?.progress]);
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
  const continueCoverUrl =
    continueBook?.metadata?.coverImageUrl || continueBook?.coverImageUrl || null;

  return (
    <main
      className={clsx(
        'full-height text-base-content flex flex-col overflow-hidden',
        'bg-[#0a0a0c]',
      )}
    >
      {/* ── Titlebar ── */}
      <AppTitleBar
        headerRef={titlebarRef}
        className='z-20 !h-[52px] !border-b !border-white/10 !bg-[#0d0d0f]/95 !shadow-[0_8px_32px_rgba(0,0,0,0.52)] sm:pr-6'
        style={{
          marginTop: appService?.hasSafeAreaInset
            ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
            : '0px',
        }}
        leftClassName='pl-5'
        leftContent={
          <Image
            src='/citadel/citadel-logo.png'
            alt='Citadel'
            width={108}
            height={28}
            className='h-auto w-[108px] object-contain opacity-90'
            style={{ height: 'auto' }}
            priority
          />
        }
        centerClassName='exclude-title-bar-mousedown relative w-full max-w-[560px] mx-auto'
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
              className='search-input input bg-base-300/40 placeholder:text-base-content/40 border-white/8 h-9 w-full rounded-lg border pr-[26%] ps-10 text-sm font-light focus:outline-none focus:ring-0 focus-visible:border-[var(--citadel-line-gold)] focus-visible:shadow-[var(--citadel-border-glow)] sm:h-7 sm:pr-[20%]'
            />
          </>
        }
        rightClassName='exclude-title-bar-mousedown pr-4'
        rightContent={
          <div className='border-white/8 flex h-full items-center gap-x-1 rounded-lg border bg-white/5 px-1 py-1 sm:gap-x-1.5'>
            <Link
              href='/library'
              aria-label={_('Library')}
              title={_('Library')}
              className='btn btn-ghost text-base-content/60 h-8 min-h-8 px-2 text-xs font-medium transition-[opacity,color] hover:text-[var(--citadel-gold)] hover:opacity-100 sm:opacity-80'
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

      {/* ── Main canvas ── */}
      <div
        className='relative flex min-h-0 flex-1 flex-col overflow-hidden'
        style={{
          paddingLeft: `max(${insets.left}px, 0px)`,
          paddingRight: `max(${insets.right}px, 0px)`,
          paddingBottom: `max(${insets.bottom}px, 0px)`,
        }}
      >
        {/* Base dark background */}
        <div className='pointer-events-none absolute inset-0 bg-[#0a0a0c]' aria-hidden='true' />

        {/* Cover-reactive atmospheric glow — positioned right */}
        {continueCoverUrl && (
          <>
            <div
              className='pointer-events-none absolute inset-0'
              aria-hidden='true'
              style={{
                backgroundImage: `url("${continueCoverUrl}")`,
                backgroundPosition: '74% 40%',
                backgroundSize: '76%',
                opacity: 0.52,
                filter: 'blur(116px) saturate(2.2) brightness(0.86)',
                transform: 'scale(1.52)',
              }}
            />
            <div
              className='pointer-events-none absolute inset-0'
              aria-hidden='true'
              style={{
                background: `radial-gradient(ellipse 58% 68% at 74% 42%, rgba(172,56,24,0.46) 0%, rgba(112,34,14,0.22) 50%, transparent 78%)`,
              }}
            />
          </>
        )}

        {/* Vignette overlays */}
        <div
          className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_24%_44%,rgba(10,10,12,0.0)_0%,rgba(8,8,10,0.76)_68%,rgba(6,6,8,0.98)_100%)]'
          aria-hidden='true'
        />
        <div
          className='pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,8,0.58)_0%,rgba(8,8,10,0.74)_52%,rgba(6,6,8,0.99)_100%)]'
          aria-hidden='true'
        />

        {/* Content */}
        <div className='relative flex min-h-0 flex-1 flex-col'>
          {/* ── Hero: editorial split stage ── */}
          <section className='relative flex min-h-0 flex-1 items-center'>
            {continueBook ? (
              <div className='mx-auto flex w-full max-w-[1320px] flex-1 items-center gap-10 px-8 py-8 xl:gap-14 xl:px-14'>
                <div className='w-full max-w-[640px]'>
                  <p className='text-[#d4af7a]/84 text-[10px] font-semibold uppercase tracking-[0.28em]'>
                    {_('Currently Reading')}
                  </p>
                  <h1
                    className='mt-4 text-[clamp(1.95rem,4.6vw,4rem)] font-semibold leading-[1.08] tracking-tight text-[#f0ede4]'
                    style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
                  >
                    {continueBook.title}
                  </h1>
                  <p className='mt-4 text-base text-[#d8d4cb] sm:text-lg'>
                    {formatAuthors(continueBook.author, continueBook.primaryLanguage) ||
                      _('Unknown author')}
                  </p>
                  {continueProgressPercent !== null && (
                    <div className='mt-8 w-full max-w-sm'>
                      <div className='mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#787672]'>
                        <span>{_('Progress')}</span>
                        <span className='text-[#a9a59c]'>{continueProgressPercent}%</span>
                      </div>
                      <div className='h-[4px] w-full overflow-hidden rounded-full bg-white/10'>
                        <div
                          className='h-full rounded-full bg-gradient-to-r from-[#c9962a] to-[#E3B230] transition-all'
                          style={{ width: `${continueProgressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className='mt-8 flex flex-wrap items-center gap-3'>
                    <button
                      type='button'
                      onClick={handleContinue}
                      className='btn btn-sm border-[#d4af7a]/54 bg-[#d4af7a]/16 hover:bg-[#d4af7a]/24 rounded-lg px-5 text-[#E3B230]'
                    >
                      {_('Continue reading')}
                    </button>
                    <button
                      type='button'
                      onClick={handleImport}
                      className='btn btn-sm btn-ghost rounded-lg border-white/10 px-4 text-[#6b6a66] hover:text-[#f0ede4]'
                    >
                      {_('Import books')}
                    </button>
                  </div>
                </div>
                <div className='relative ml-auto flex w-full max-w-[430px] items-center justify-center'>
                  <button
                    type='button'
                    onClick={handleContinue}
                    className='group block focus:outline-none'
                    aria-label={_('Continue reading {{title}}', { title: continueBook.title })}
                  >
                    {/* Hero-local cover glow */}
                    {continueCoverUrl && (
                      <div
                        className='pointer-events-none absolute inset-[-28%] rounded-3xl'
                        aria-hidden='true'
                        style={{
                          backgroundImage: `url("${continueCoverUrl}")`,
                          backgroundSize: '70%',
                          backgroundPosition: '72% 44%',
                          opacity: 0.6,
                          filter: 'blur(96px) saturate(2.05) brightness(0.85)',
                          transform: 'scale(1.35)',
                        }}
                      />
                    )}
                    <div className='relative h-[clamp(324px,52vh,600px)] w-[clamp(216px,34vh,404px)] overflow-hidden rounded-3xl border border-white/10 bg-[#131315] shadow-[0_34px_68px_rgba(0,0,0,0.58)] transition-transform duration-200 group-hover:-translate-y-1'>
                      {hasCoverImage(continueBook) ? (
                        <BookCover
                          book={continueBook}
                          mode='grid'
                          coverFit='crop'
                          imageClassName='rounded-3xl'
                          className='h-full w-full'
                        />
                      ) : (
                        <div className='flex h-full w-full flex-col justify-between rounded-3xl bg-[linear-gradient(180deg,#1b1b1d_0%,#0f0f11_100%)] p-6'>
                          <span className='text-xs font-semibold uppercase tracking-[0.2em] text-[#d4af7a]'>
                            {_('Citadel')}
                          </span>
                          <span className='line-clamp-5 text-left text-xl font-medium text-[#f0ede4]'>
                            {continueBook.title}
                          </span>
                          <span className='line-clamp-1 text-left text-xs text-[#8a8883]'>
                            {formatAuthors(continueBook.author, continueBook.primaryLanguage) ||
                              _('Unknown author')}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              /* Empty state — centered */
              <div className='w-full max-w-[700px] text-center'>
                <h1
                  className='mt-3 text-3xl font-semibold tracking-tight text-[#f0ede4] sm:text-4xl'
                  style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
                >
                  {_('Welcome to Citadel')}
                </h1>
                <p className='mx-auto mt-3 max-w-xl text-sm text-[#8a8883] sm:text-base'>
                  {_('Choose a book from your library when you are ready, or import one to begin.')}
                </p>
                <div className='mt-5 flex flex-wrap items-center justify-center gap-3'>
                  <Link
                    href='/library'
                    className='btn btn-sm btn-ghost rounded-lg border-white/10 text-[#8a8883] hover:text-[#f0ede4]'
                  >
                    {_('Open library')}
                  </Link>
                  <button
                    type='button'
                    onClick={handleImport}
                    className='btn btn-sm bg-[#d4af7a]/16 hover:bg-[#d4af7a]/24 rounded-lg border-[#d4af7a]/60 text-[#E3B230]'
                  >
                    {_('Import books')}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Shelf ── */}
          <section className='border-white/12 mt-auto w-full flex-shrink-0 border-t bg-[linear-gradient(180deg,rgba(14,14,16,0.55)_0%,rgba(8,8,10,0.88)_100%)] px-6 pb-10 pt-4 sm:px-10 xl:px-14'>
            <div className='mx-auto flex w-full max-w-[1320px] items-center justify-between gap-4 px-0.5'>
              <h2 className='text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4af7a]/80'>
                {hasSearchQuery ? _('Search Results') : _('Your Library')}
              </h2>
              <Link href='/library' className='text-[10px] text-[#9a978f] hover:text-[#f0ede4]'>
                {_('View all')}
              </Link>
            </div>
            {filteredRecentBooks.length > 0 ? (
              <div className='mx-auto mt-4 flex w-full max-w-[1320px] gap-5 overflow-x-auto py-2'>
                {filteredRecentBooks.map((book) => (
                  <button
                    key={book.hash}
                    className='group w-[134px] flex-shrink-0 text-left xl:w-[156px]'
                    onClick={() => navigateToReader(router, [book.hash])}
                  >
                    <div className='border-white/6 h-[196px] overflow-hidden rounded-2xl border bg-[#131315] shadow-[0_10px_20px_rgba(0,0,0,0.26)] transition-transform duration-200 group-hover:-translate-y-0.5 xl:h-[228px]'>
                      {hasCoverImage(book) ? (
                        <BookCover
                          book={book}
                          mode='grid'
                          coverFit='crop'
                          imageClassName='rounded-2xl'
                          className='h-full w-full'
                        />
                      ) : (
                        <div className='flex h-full w-full items-center justify-center rounded-2xl bg-[linear-gradient(180deg,color-mix(in_srgb,var(--citadel-bg-dark)_72%,theme(colors.base-100)_28%)_0%,color-mix(in_srgb,var(--citadel-bg-dark)_90%,black_10%)_100%)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--citadel-gold)]'>
                          {_('Citadel')}
                        </div>
                      )}
                    </div>
                    <p className='mt-2.5 line-clamp-1 text-[12px] font-medium text-[#f0ede4]'>
                      {book.title}
                    </p>
                    <p className='mt-0.5 line-clamp-1 text-[10px] text-[#6b6a66]'>
                      {formatAuthors(book.author, book.primaryLanguage) || _('Unknown author')}
                    </p>
                  </button>
                ))}
              </div>
            ) : hasSearchQuery ? (
              <p className='mt-3 px-0.5 text-xs text-[#8a8883]'>
                {_('No books match this search yet. Try a different title or author.')}
              </p>
            ) : (
              <p className='mt-3 px-0.5 text-xs text-[#8a8883]'>
                {_('No books yet. Open Library to import and organize your collection.')}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
