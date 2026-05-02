'use client';

import clsx from 'clsx';
import Image from 'next/image';
import Link from 'next/link';
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaSearch } from 'react-icons/fa';

import WindowButtons from '@/components/WindowButtons';
import AppTitleBar from '@/components/AppTitleBar';
import BookObject from '@/components/BookObject';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { navigateToReader } from '@/utils/nav';
import { formatAuthors } from '@/utils/book';
import { type SelectedFile } from '@/hooks/useFileSelector';

const HOME_PREVIEW_LIMIT = 6;
const SHELF_BOOK_WIDTH = 'clamp(112px, 8.8vw, 160px)';
const SHELF_BOOK_HEIGHT = 'clamp(168px, 13.2vw, 236px)';
const SUPPORTED_DROP_EXTENSIONS = new Set([
  'epub',
  'mobi',
  'azw',
  'azw3',
  'pdf',
  'fb2',
  'cbz',
  'cbr',
  'txt',
  'html',
  'htm',
]);

const getDroppedPathExtension = (path: string) => {
  const cleanPath = path.split(/[?#]/)[0] ?? path;
  const extension = cleanPath.split('.').pop()?.trim().toLowerCase() ?? '';
  return extension;
};

const isSupportedDroppedBookPath = (path: string) =>
  SUPPORTED_DROP_EXTENSIONS.has(getDroppedPathExtension(path));

const FEATURED_FRAME_WINDOW_STYLE = {
  left: '13%',
  right: '6.2%',
  top: '7.2%',
  bottom: '6.5%',
} as const;

type HoverTiltState = {
  rotateX: number;
  rotateY: number;
  translateY: number;
  scale: number;
};

const FEATURED_REST_TILT: HoverTiltState = {
  rotateX: 0,
  rotateY: 0,
  translateY: 0,
  scale: 1,
};

const SHELF_REST_TILT: HoverTiltState = {
  rotateX: 0,
  rotateY: 0,
  translateY: 0,
  scale: 1,
};

const FEATURED_FRAME_MASK_STYLE = {
  WebkitMaskImage: "url('/citadel/book-frame-mask-alpha-clean.png')",
  maskImage: "url('/citadel/book-frame-mask-alpha-clean.png')",
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
} as const;

const DEFAULT_FRAME_TINT_COLOR = '#090807';
const cleanFeaturedTitle = (title: string) =>
  title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const rgbToHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const mixColor = (
  source: [number, number, number],
  target: [number, number, number],
  amount: number,
): [number, number, number] => [
  source[0] + (target[0] - source[0]) * amount,
  source[1] + (target[1] - source[1]) * amount,
  source[2] + (target[2] - source[2]) * amount,
];

const clampFrameColor = (red: number, green: number, blue: number) => {
  const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel - minChannel;
  const warmFallback: [number, number, number] = [11, 8, 7];
  let adjusted: [number, number, number] = [red, green, blue];

  if (brightness < 62) {
    adjusted = mixColor([red, green, blue], warmFallback, saturation < 24 ? 0.72 : 0.5);
  } else {
    adjusted = [red * 0.22, green * 0.18, blue * 0.15];
    if (saturation < 26) {
      adjusted = mixColor(adjusted, warmFallback, 0.56);
    }
  }

  return rgbToHex(
    Math.max(3, Math.min(22, adjusted[0] ?? 3)),
    Math.max(3, Math.min(19, adjusted[1] ?? 3)),
    Math.max(3, Math.min(17, adjusted[2] ?? 3)),
  );
};

const getDominantCoverColor = async (imageUrl: string): Promise<string> => {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';

  const loadPromise = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load cover image.'));
  });

  image.src = imageUrl;
  await loadPromise;

  const sampleCanvas = document.createElement('canvas');
  const sampleWidth = 32;
  const sampleHeight = 48;
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;

  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return DEFAULT_FRAME_TINT_COLOR;

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const buckets = new Map<
    string,
    { totalWeight: number; red: number; green: number; blue: number }
  >();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 0;
    if (alpha < 32) continue;

    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;
    if (brightness > 242 || brightness < 8) continue;

    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (brightness > 230 && saturation < 22) continue;

    const bucketRed = Math.round(red / 32) * 32;
    const bucketGreen = Math.round(green / 32) * 32;
    const bucketBlue = Math.round(blue / 32) * 32;
    const bucketKey = `${bucketRed}-${bucketGreen}-${bucketBlue}`;
    const weight =
      1 +
      saturation / 42 +
      Math.max(0, (168 - Math.abs(brightness - 88)) / 168) +
      (brightness < 58 ? 0.42 : 0);

    const bucket = buckets.get(bucketKey) ?? {
      totalWeight: 0,
      red: 0,
      green: 0,
      blue: 0,
    };

    bucket.totalWeight += weight;
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    buckets.set(bucketKey, bucket);
  }

  const dominantBucket = [...buckets.values()].sort(
    (left, right) => right.totalWeight - left.totalWeight,
  )[0];

  if (!dominantBucket) return DEFAULT_FRAME_TINT_COLOR;

  return clampFrameColor(
    dominantBucket.red / dominantBucket.totalWeight,
    dominantBucket.green / dominantBucket.totalWeight,
    dominantBucket.blue / dominantBucket.totalWeight,
  );
};

export default function HomePage() {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const { safeAreaInsets: insets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { library, setLibrary } = useLibraryStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [frameTintColor, setFrameTintColor] = useState(DEFAULT_FRAME_TINT_COLOR);
  const [isDragOverlayVisible, setIsDragOverlayVisible] = useState(false);
  const [isImportingDroppedBooks, setIsImportingDroppedBooks] = useState(false);
  const [shouldRenderDropOverlay, setShouldRenderDropOverlay] = useState(false);
  const [featuredTilt, setFeaturedTilt] = useState<HoverTiltState>(FEATURED_REST_TILT);
  const [activeShelfTilt, setActiveShelfTilt] = useState<{
    hash: string | null;
    tilt: HoverTiltState;
  }>({
    hash: null,
    tilt: SHELF_REST_TILT,
  });
  const titlebarRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const handledTauriDropAtRef = useRef(0);

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

  const sortedShelfBooks = useMemo(() => {
    return [...visibleBooks].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [visibleBooks]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredShelfBooks = useMemo(() => {
    if (!normalizedSearchQuery) return sortedShelfBooks.slice(0, HOME_PREVIEW_LIMIT);
    return sortedShelfBooks
      .filter((book) => {
        const searchableAuthor =
          formatAuthors(book.author, book.primaryLanguage) || book.author || '';
        const searchableText = `${book.title} ${searchableAuthor}`.toLowerCase();
        return searchableText.includes(normalizedSearchQuery);
      })
      .slice(0, HOME_PREVIEW_LIMIT);
  }, [normalizedSearchQuery, sortedShelfBooks]);

  const handleContinue = () => {
    if (!continueBook) return;
    navigateToReader(router, [continueBook.hash]);
  };

  const hasCoverImage = (book: (typeof visibleBooks)[number] | null | undefined) =>
    !!(book?.metadata?.coverImageUrl || book?.coverImageUrl);

  const continueProgressPercent = useMemo(() => {
    const progress = continueBook?.progress;
    if (!progress) return null;

    if (Array.isArray(progress)) {
      const [current = 0, total = 0] = progress;
      if (!total || current <= 0) return null;
      return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
    }

    if (typeof progress !== 'number' || progress <= 0) return null;
    const normalized = progress <= 1 ? progress * 100 : progress;
    return Math.max(0, Math.min(100, Math.round(normalized)));
  }, [continueBook?.progress]);

  const importBooks = useCallback(
    async (files: SelectedFile[]) => {
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
    },
    [appService, envConfig, setLibrary],
  );

  const windowButtonVisible = !!appService?.hasWindowBar;
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const continueCoverUrl =
    continueBook?.metadata?.coverImageUrl || continueBook?.coverImageUrl || null;

  const dragEventHasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const isSupportedDroppedFile = (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension) return true;
    return SUPPORTED_DROP_EXTENSIONS.has(extension);
  };

  useEffect(() => {
    let cancelled = false;

    const updateFrameTint = async () => {
      if (!continueCoverUrl) {
        setFrameTintColor(DEFAULT_FRAME_TINT_COLOR);
        return;
      }

      try {
        const nextTint = await getDominantCoverColor(continueCoverUrl);
        if (!cancelled) setFrameTintColor(nextTint);
      } catch {
        if (!cancelled) setFrameTintColor(DEFAULT_FRAME_TINT_COLOR);
      }
    };

    updateFrameTint();

    return () => {
      cancelled = true;
    };
  }, [continueCoverUrl]);

  useEffect(() => {
    if (isDragOverlayVisible || isImportingDroppedBooks) {
      setShouldRenderDropOverlay(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShouldRenderDropOverlay(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [isDragOverlayVisible, isImportingDroppedBooks]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupTauriDrop = async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        if (disposed) return;

        unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
          const payload = event.payload;

          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDragOverlayVisible(true);
            return;
          }

          if (payload.type === 'drop') {
            handledTauriDropAtRef.current = Date.now();
            dragDepthRef.current = 0;
            setIsDragOverlayVisible(false);

            const droppedPaths = Array.isArray(payload.paths) ? payload.paths : [];
            const supportedPaths = droppedPaths.filter(isSupportedDroppedBookPath);
            if (!supportedPaths.length) return;

            try {
              setIsImportingDroppedBooks(true);
              await importBooks(supportedPaths.map((path) => ({ path })));
            } finally {
              setIsImportingDroppedBooks(false);
            }

            return;
          }

          setIsDragOverlayVisible(false);
        });
      } catch (error) {
        console.warn('[Citadel] Tauri drag/drop unavailable, using DOM fallback only.', error);
      }
    };

    setupTauriDrop();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importBooks]);

  useEffect(() => {
    const hideDragOverlay = () => {
      dragDepthRef.current = 0;
      setIsDragOverlayVisible(false);
    };

    const handleWindowDragEnter = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragOverlayVisible(true);
    };

    const handleWindowDragOver = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDragOverlayVisible(true);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current -= 1;
      if (dragDepthRef.current <= 0) {
        hideDragOverlay();
      }
    };

    const handleWindowDrop = async (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      hideDragOverlay();

      if (Date.now() - handledTauriDropAtRef.current < 250) {
        return;
      }

      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      const validFiles = droppedFiles.filter(isSupportedDroppedFile);
      if (!validFiles.length) return;

      const selectedFiles: SelectedFile[] = validFiles.map((file) => {
        const droppedPath =
          'path' in file && typeof file.path === 'string' && file.path.length > 0
            ? file.path
            : undefined;
        return droppedPath ? { file, path: droppedPath } : { file };
      });

      try {
        setIsImportingDroppedBooks(true);
        await importBooks(selectedFiles);
      } catch (error) {
        console.warn('Failed to import dropped books.', error);
      } finally {
        setIsImportingDroppedBooks(false);
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [importBooks]);

  const handleFeaturedPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
    const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

    setFeaturedTilt({
      rotateX: offsetY * -7,
      rotateY: offsetX * 10,
      translateY: -10,
      scale: 1.008,
    });
  };

  const resetFeaturedTilt = () => {
    setFeaturedTilt(FEATURED_REST_TILT);
  };

  const handleShelfPointerMove =
    (hash: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
      const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

      setActiveShelfTilt({
        hash,
        tilt: {
          rotateX: offsetY * -4,
          rotateY: offsetX * 6,
          translateY: -6,
          scale: 1.018,
        },
      });
    };

  const resetShelfTilt = () => {
    setActiveShelfTilt({
      hash: null,
      tilt: SHELF_REST_TILT,
    });
  };

  const featuredTiltStyle: CSSProperties = {
    transform: `perspective(1280px) translateZ(0) rotateX(${featuredTilt.rotateX}deg) rotateY(${featuredTilt.rotateY}deg) translateY(${featuredTilt.translateY}px) scale(${featuredTilt.scale})`,
    transformStyle: 'preserve-3d',
    transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), filter 260ms ease',
    willChange: 'transform',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };

  const featuredGlareStyle: CSSProperties = {
    opacity: featuredTilt.translateY !== 0 ? 0.16 : 0,
    background: `radial-gradient(circle at ${50 + featuredTilt.rotateY * 2.6}% ${42 - featuredTilt.rotateX * 2.4}%, rgba(255, 236, 196, 0.22) 0%, rgba(255, 224, 168, 0.12) 18%, rgba(255,255,255,0.02) 42%, transparent 62%)`,
    transition: 'opacity 240ms ease, background 240ms ease',
    mixBlendMode: 'screen',
  };

  if (!appService || !insets || isLoading) {
    return <div className='full-height bg-base-200' />;
  }

  return (
    <main
      className={clsx(
        'full-height text-base-content relative isolate flex flex-col overflow-hidden',
        'bg-[#030303]',
      )}
      style={{
        backgroundColor: '#040404',
        backgroundImage: `
          radial-gradient(ellipse 42% 52% at 70% 38%, rgba(205, 18, 18, 0.30) 0%, rgba(145, 10, 10, 0.22) 26%, rgba(78, 5, 7, 0.14) 48%, rgba(32, 2, 2, 0.05) 66%, transparent 80%),
          radial-gradient(ellipse 30% 44% at 74% 42%, rgba(255, 38, 24, 0.22) 0%, rgba(178, 18, 16, 0.12) 32%, transparent 72%),
          radial-gradient(ellipse 120% 100% at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 42%),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 6px),
          repeating-linear-gradient(90deg, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 1px, transparent 1px, transparent 7px),
          radial-gradient(ellipse 125% 120% at 50% 50%, transparent 52%, rgba(0,0,0,0.38) 78%, rgba(0,0,0,0.82) 100%)
        `,
        backgroundBlendMode: 'screen, screen, soft-light, overlay, overlay, normal',
      }}
    >
      {/* ── Titlebar ── */}
      <AppTitleBar
        headerRef={titlebarRef}
        contentClassName='items-center gap-2 sm:gap-4'
        className='z-20 !h-[74px] !min-h-[74px] !border-0 !border-transparent !bg-transparent !bg-none !shadow-none !backdrop-blur-none sm:!h-[76px] dark:!border-0 dark:!border-transparent dark:!bg-transparent dark:!bg-none dark:!shadow-none dark:!backdrop-blur-none'
        style={{
          marginTop: appService?.hasSafeAreaInset
            ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
            : '0px',
          background: 'transparent',
          backgroundColor: 'transparent',
          borderBottom: '0',
          boxShadow: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        }}
        leftClassName='flex shrink-0 items-center pl-7 pr-1 sm:pl-9 sm:pr-2'
        leftContent={
          <div className='flex translate-y-[20px] items-center'>
            <Image
              src='/citadel/citadel-logo.png'
              alt='Citadel'
              width={152}
              height={42}
              className='h-auto w-[126px] object-contain sm:w-[146px]'
              priority
            />
          </div>
        }
        centerClassName='exclude-title-bar-mousedown flex min-w-0 flex-1 items-center justify-end pl-2 pr-0 sm:pl-3 sm:pr-0'
        centerContent={null}
        rightClassName='exclude-title-bar-mousedown flex shrink-0 items-center gap-2 pr-5 sm:gap-2.5 sm:pr-7'
        rightContent={
          <>
            <div className='relative w-full max-w-[220px] sm:max-w-[238px]'>
              <span className='absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-[#8f887b]'>
                <FaSearch className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
              </span>
              <input
                type='text'
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={_('Search books, authors...')}
                spellCheck='false'
                className='search-input input h-8 w-full rounded-[6px] border border-white/[0.06] bg-[rgba(8,8,9,0.16)] py-0 pe-10 ps-9 font-sans text-sm font-normal tracking-normal text-[#e8dfd0] shadow-[inset_0_1px_0_rgba(255,248,235,0.02)] backdrop-blur-[1px] placeholder:text-[#766f65] focus:outline-none focus:ring-0 focus-visible:border-[rgba(155,106,30,0.62)] focus-visible:shadow-none sm:h-8 sm:pe-11 sm:ps-10'
              />
            </div>
            <Link
              href='/library'
              aria-label={_('Library')}
              title={_('Library')}
              className='inline-flex h-8 shrink-0 items-center rounded-[5px] border border-[rgba(155,106,30,0.78)] bg-[rgba(8,8,9,0.14)] px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#b9852c] backdrop-blur-[1px] transition-colors hover:border-[#b9852c] hover:bg-[rgba(20,16,12,0.22)] hover:text-[#c99535] sm:px-4'
            >
              {_('Library')}
            </Link>
            <WindowButtons
              headerRef={titlebarRef}
              className='gap-1 pr-0 text-[#b9852c] [&_button:hover]:!bg-transparent [&_button:hover]:text-[#c99535] [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:text-[#b9852c] [&_button]:!shadow-none [&_svg]:stroke-[#b9852c] [&_svg]:text-[#b9852c]'
              showMinimize={windowButtonVisible}
              showMaximize={windowButtonVisible}
              showClose={windowButtonVisible}
            />
          </>
        }
      />

      {/* ── Page-level ambient glow ──
          Placed here (direct child of main) so it is NOT clipped by the
          overflow-hidden on the hero section. The hero section clips its own
          absolute children at its top boundary, cutting the glow at the
          header edge. At z-0 inside main's stacking context (main has
          isolate) this sits above the page background but below z-10 hero
          content and z-20 titlebar. ── */}
      {continueBook && (
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 z-0'
          style={{
            background: `
              radial-gradient(ellipse 46% 68% at 80% 46%, rgba(152, 9, 5, 0.18) 0%, rgba(92, 5, 3, 0.09) 44%, rgba(44, 2, 1, 0.03) 70%, transparent 90%),
              radial-gradient(ellipse 36% 54% at 80% 45%, rgba(208, 15, 10, 0.34) 0%, rgba(138, 9, 6, 0.16) 40%, rgba(64, 4, 3, 0.04) 66%, transparent 88%),
              radial-gradient(ellipse 20% 32% at 81% 43%, rgba(248, 42, 20, 0.11) 0%, rgba(182, 16, 8, 0.03) 52%, transparent 82%)
            `,
            filter: 'blur(36px)',
          }}
        />
      )}

      {/* ── Main canvas ── */}
      <div
        className='relative flex min-h-0 flex-1 flex-col overflow-hidden'
        style={{
          paddingLeft: `max(${insets.left}px, 0px)`,
          paddingRight: `max(${insets.right}px, 0px)`,
          paddingBottom: `max(${insets.bottom}px, 0px)`,
        }}
      >
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          {/* ── Hero ── */}
          <section className='relative flex flex-1 items-center justify-center overflow-hidden'>
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-0'
              style={{
                backgroundImage: `
                  radial-gradient(circle at 20% 25%, rgba(255,255,255,0.02) 0%, transparent 22%),
                  radial-gradient(circle at 78% 40%, rgba(255,255,255,0.018) 0%, transparent 18%),
                  repeating-linear-gradient(0deg, rgba(255,255,255,0.008) 0px, rgba(255,255,255,0.008) 1px, transparent 1px, transparent 5px)
                `,
                mixBlendMode: 'soft-light',
                opacity: 0.22,
              }}
            />
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-0'
              style={{
                background:
                  'linear-gradient(100deg, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.04) 34%, transparent 52%, rgba(16,3,2,0.05) 80%, transparent 100%)',
              }}
            />
            {continueBook ? (
              <div className='relative z-10 mx-auto flex w-full max-w-[1500px] items-center justify-between gap-8 px-6 sm:px-8 lg:gap-12 lg:px-12 xl:gap-16 xl:px-16'>
                {/* ── Left column ── */}
                <div className='min-w-0 max-w-[41rem] flex-1 xl:-translate-x-10 2xl:-translate-x-16'>
                  <p className='inline-block text-[12px] font-semibold uppercase tracking-[0.28em] text-[#9b6a1e]'>
                    {_('Currently Reading')}
                  </p>
                  <h1
                    className='mt-3 text-[clamp(3rem,5.8vw,6.15rem)] font-medium leading-[0.98] tracking-[-0.03em] text-[#f3ead4]'
                    style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
                  >
                    {cleanFeaturedTitle(continueBook.title)}
                  </h1>
                  <p
                    className='mt-4 text-[clamp(1.2rem,1.7vw,1.55rem)] text-[#a97716]'
                    style={{ fontFamily: 'Georgia, serif' }}
                  >
                    {formatAuthors(continueBook.author, continueBook.primaryLanguage) ||
                      _('Unknown author')}
                  </p>

                  {continueProgressPercent !== null && continueProgressPercent > 0 && (
                    <div className='mt-7 max-w-[400px]'>
                      <div className='mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[#6b6a66]'>
                        <span>{_('Reading progress')}</span>
                        <span>{continueProgressPercent}%</span>
                      </div>
                      <div className='h-[3px] w-full overflow-hidden rounded-full bg-white/10'>
                        <div
                          className='h-full rounded-full bg-[#E3B230] transition-all duration-500'
                          style={{ width: `${continueProgressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Right column: featured physical book ── */}
                <div className='relative mr-1 flex flex-shrink-0 items-center justify-center overflow-visible sm:mr-2 lg:mr-4 xl:mr-8'>
                  <div
                    aria-hidden='true'
                    className='pointer-events-none absolute bottom-0 left-1/2 z-0 -translate-x-1/2 translate-y-[14px]'
                    style={{
                      width: '82%',
                      height: '28px',
                      borderRadius: '50%',
                      background:
                        'radial-gradient(ellipse at center, rgba(0,0,0,0.56) 0%, rgba(0,0,0,0.28) 42%, rgba(0,0,0,0.07) 70%, transparent 90%)',
                      filter: 'blur(14px)',
                    }}
                  />
                  <button
                    type='button'
                    onClick={handleContinue}
                    className='group relative z-10 block focus:outline-none'
                    aria-label={_('Continue reading {{title}}', { title: continueBook.title })}
                    onPointerMove={handleFeaturedPointerMove}
                    onPointerLeave={resetFeaturedTilt}
                    onPointerCancel={resetFeaturedTilt}
                  >
                    <div
                      className='relative isolate aspect-[0.78] max-h-[min(70vh,620px)] w-[clamp(280px,24vw,410px)]'
                      style={{
                        ...featuredTiltStyle,
                        filter:
                          featuredTilt.translateY !== 0
                            ? 'drop-shadow(0 28px 46px rgba(0,0,0,0.80)) drop-shadow(0 58px 96px rgba(0,0,0,0.34))'
                            : 'drop-shadow(0 20px 38px rgba(0,0,0,0.72)) drop-shadow(0 50px 84px rgba(0,0,0,0.28))',
                      }}
                    >
                      <div
                        className='absolute z-0 overflow-hidden bg-[#030303]'
                        style={{ ...FEATURED_FRAME_WINDOW_STYLE, borderRadius: '3px' }}
                      >
                        {continueCoverUrl ? (
                          <img
                            src={continueCoverUrl}
                            alt={continueBook.title}
                            className='h-full w-full object-cover'
                            style={{
                              objectPosition: '52% 50%',
                              filter: 'brightness(0.92) contrast(1.12) saturate(0.9) sepia(0.03)',
                              transform: 'translateZ(0)',
                              backfaceVisibility: 'hidden',
                              WebkitBackfaceVisibility: 'hidden',
                            }}
                            draggable={false}
                          />
                        ) : (
                          <div className='flex h-full w-full flex-col justify-between bg-[linear-gradient(180deg,#1b1b1d_0%,#0f0f11_100%)] p-6'>
                            <span className='text-xs font-semibold uppercase tracking-[0.2em] text-[#9b6a1e]'>
                              Citadel
                            </span>
                            <span className='text-left text-xl font-medium text-[#e5dccd]'>
                              {cleanFeaturedTitle(continueBook.title)}
                            </span>
                            <span className='text-left text-xs text-[#8a8883]'>
                              {formatAuthors(continueBook.author, continueBook.primaryLanguage) ||
                                _('Unknown author')}
                            </span>
                          </div>
                        )}
                        <div
                          className='pointer-events-none absolute inset-0'
                          aria-hidden='true'
                          style={{
                            background:
                              'linear-gradient(90deg, rgba(0,0,0,0.18) 0%, transparent 22%, transparent 76%, rgba(0,0,0,0.22) 100%)',
                          }}
                        />
                      </div>

                      <div
                        className='pointer-events-none absolute inset-0 z-10'
                        aria-hidden='true'
                        style={{
                          background: `
                            linear-gradient(
                              90deg,
                              color-mix(in srgb, ${frameTintColor} 42%, black 58%) 0%,
                              color-mix(in srgb, ${frameTintColor} 68%, black 32%) 17%,
                              color-mix(in srgb, ${frameTintColor} 84%, black 16%) 48%,
                              color-mix(in srgb, ${frameTintColor} 70%, black 30%) 76%,
                              color-mix(in srgb, ${frameTintColor} 46%, black 54%) 100%
                            )
                          `,
                          ...FEATURED_FRAME_MASK_STYLE,
                          filter: 'brightness(0.78) contrast(1.2) saturate(1.05)',
                        }}
                      />

                      <div
                        className='pointer-events-none absolute inset-0 z-20 opacity-[0.92] mix-blend-multiply'
                        aria-hidden='true'
                        style={{
                          background:
                            'linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.24) 13%, rgba(255,255,255,0.03) 44%, rgba(0,0,0,0.28) 78%, rgba(0,0,0,0.56) 100%)',
                          ...FEATURED_FRAME_MASK_STYLE,
                        }}
                      />

                      <div
                        className='pointer-events-none absolute inset-0 z-30 opacity-[0.62] mix-blend-multiply'
                        aria-hidden='true'
                        style={{
                          background:
                            'radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.26) 70%, rgba(0,0,0,0.54) 100%)',
                          ...FEATURED_FRAME_MASK_STYLE,
                        }}
                      />

                      <Image
                        src='/citadel/book-frame-detail-overlay.png'
                        alt=''
                        fill
                        priority
                        draggable={false}
                        className='pointer-events-none absolute inset-0 z-40 h-full w-full object-contain opacity-[0.48]'
                        style={{
                          mixBlendMode: 'screen',
                          filter: 'grayscale(1) contrast(1.38) brightness(0.80)',
                        }}
                      />
                      <div
                        className='pointer-events-none absolute inset-0 z-50'
                        aria-hidden='true'
                        style={featuredGlareStyle}
                      />
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              /* Empty state — centered */
              <div className='relative w-full max-w-[700px] text-center'>
                <h1
                  className='mt-3 text-3xl font-medium tracking-[-0.02em] text-[#e5dccd] sm:text-4xl'
                  style={{
                    fontFamily:
                      'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
                  }}
                >
                  {_('Welcome to Citadel')}
                </h1>
                <p className='mx-auto mt-3 max-w-xl font-sans text-sm text-[#9a958c] sm:text-base'>
                  {_('Choose a book from your library when you are ready, or import one to begin.')}
                </p>
                <div className='mt-5 flex flex-wrap items-center justify-center gap-3'>
                  <Link
                    href='/library'
                    className='btn btn-sm btn-ghost rounded-lg border-white/[0.07] font-sans text-[#9a958c] hover:text-[#e5dccd]'
                  >
                    {_('Open library')}
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* ── Shelf ── */}
          <section className='w-full flex-shrink-0 overflow-visible !border-0 !border-transparent !bg-transparent !bg-none px-6 pb-10 pt-6 !shadow-none !backdrop-blur-none sm:px-8 lg:px-10 xl:px-14'>
            {filteredShelfBooks.length > 0 ? (
              <div className='relative mx-auto flex w-full max-w-[1480px] items-center justify-center overflow-visible px-[clamp(44px,8vw,112px)]'>
                <button
                  type='button'
                  className='absolute left-[clamp(18px,3vw,56px)] top-1/2 z-20 -translate-y-1/2 bg-transparent px-0 text-[42px] leading-none text-[#c08a2c] opacity-90 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] transition hover:text-[#e0aa42] hover:opacity-100'
                  onClick={() => {
                    const el = document.getElementById('shelf-scroll');
                    if (el) el.scrollLeft -= 300;
                  }}
                  aria-label={_('Scroll left')}
                >
                  ‹
                </button>

                <div
                  id='shelf-scroll'
                  className='flex max-w-full items-start justify-center overflow-x-auto scroll-smooth px-6 pb-5 pt-4 sm:px-8'
                  style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    gap: 'clamp(20px, 3vw, 52px)',
                  }}
                >
                  {filteredShelfBooks.map((book) => (
                    <button
                      key={book.hash}
                      className='group flex-shrink-0 overflow-visible text-left'
                      style={{ width: SHELF_BOOK_WIDTH }}
                      onClick={() => navigateToReader(router, [book.hash])}
                      onPointerMove={handleShelfPointerMove(book.hash)}
                      onPointerLeave={resetShelfTilt}
                      onPointerCancel={resetShelfTilt}
                    >
                      {(() => {
                        const shelfTilt =
                          activeShelfTilt.hash === book.hash
                            ? activeShelfTilt.tilt
                            : SHELF_REST_TILT;
                        const shelfTiltStyle: CSSProperties = {
                          transform: `perspective(1080px) translateZ(0) rotateX(${shelfTilt.rotateX}deg) rotateY(${shelfTilt.rotateY}deg) translateY(${shelfTilt.translateY}px) scale(${shelfTilt.scale})`,
                          transformStyle: 'preserve-3d',
                          transition:
                            'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease, border-color 220ms ease',
                          willChange: 'transform',
                          backfaceVisibility: 'hidden',
                          WebkitBackfaceVisibility: 'hidden',
                        };

                        const shelfGlareStyle: CSSProperties = {
                          opacity: activeShelfTilt.hash === book.hash ? 0.14 : 0,
                          background: `radial-gradient(circle at ${50 + shelfTilt.rotateY * 3.2}% ${38 - shelfTilt.rotateX * 3.1}%, rgba(255, 228, 184, 0.18) 0%, rgba(255, 220, 166, 0.08) 22%, rgba(255,255,255,0.02) 46%, transparent 64%)`,
                          transition: 'opacity 220ms ease, background 220ms ease',
                          mixBlendMode: 'screen',
                        };

                        return (
                          <div className='relative overflow-visible'>
                            <div
                              className='relative overflow-hidden rounded-[12px] border bg-[linear-gradient(180deg,rgba(18,18,20,0.96)_0%,rgba(12,12,14,0.92)_100%)] group-hover:border-[rgba(208,151,54,0.95)]'
                              style={{
                                width: SHELF_BOOK_WIDTH,
                                height: SHELF_BOOK_HEIGHT,
                                border: '2px solid rgba(186, 132, 36, 0.95)',
                                boxShadow:
                                  activeShelfTilt.hash === book.hash
                                    ? '0 16px 34px rgba(0,0,0,0.5), 0 0 0 1px rgba(227, 178, 48, 0.16)'
                                    : '0 10px 24px rgba(0,0,0,0.42), 0 0 0 1px rgba(227, 178, 48, 0.10)',
                                ...shelfTiltStyle,
                              }}
                            >
                              {hasCoverImage(book) ? (
                                <BookObject
                                  book={book}
                                  mode='grid'
                                  coverFit='crop'
                                  variant='library'
                                  interactive={true}
                                  coverClassName='rounded-[10px]'
                                  className='h-full w-full'
                                />
                              ) : (
                                <div className='flex h-full w-full items-center justify-center rounded-[10px] bg-[#1b1b1d] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4af7a]'>
                                  Citadel
                                </div>
                              )}
                              <div
                                className='pointer-events-none absolute inset-0 rounded-[12px]'
                                aria-hidden='true'
                                style={{
                                  background:
                                    'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 100%)',
                                }}
                              />
                              <div
                                className='pointer-events-none absolute inset-0 rounded-[12px]'
                                aria-hidden='true'
                                style={shelfGlareStyle}
                              />
                              <div
                                className='pointer-events-none absolute inset-0 rounded-[12px]'
                                aria-hidden='true'
                                style={{
                                  background:
                                    'linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.16) 100%)',
                                }}
                              />
                              <div
                                className='pointer-events-none absolute inset-0 rounded-[12px]'
                                aria-hidden='true'
                                style={{
                                  boxShadow: 'inset 0 0 0 1px rgba(185,133,44,0.12)',
                                }}
                              />
                            </div>
                            <p className='mt-2 line-clamp-1 text-[11px] font-medium text-[#f0ede4]'>
                              {book.title}
                            </p>
                            <p className='mt-0.5 line-clamp-1 text-[10px] text-[#7c766d]'>
                              {formatAuthors(book.author, book.primaryLanguage) ||
                                _('Unknown author')}
                            </p>
                          </div>
                        );
                      })()}
                    </button>
                  ))}
                </div>

                <button
                  type='button'
                  className='absolute right-[clamp(18px,3vw,56px)] top-1/2 z-20 -translate-y-1/2 bg-transparent px-0 text-[42px] leading-none text-[#c08a2c] opacity-90 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] transition hover:text-[#e0aa42] hover:opacity-100'
                  onClick={() => {
                    const el = document.getElementById('shelf-scroll');
                    if (el) el.scrollLeft += 300;
                  }}
                  aria-label={_('Scroll right')}
                >
                  ›
                </button>
              </div>
            ) : hasSearchQuery ? (
              <p className='text-xs text-[#8a8883]'>{_('No books match this search.')}</p>
            ) : (
              <p className='text-xs text-[#8a8883]'>{_('No books yet. Import some to begin.')}</p>
            )}
          </section>
        </div>
      </div>
      {shouldRenderDropOverlay && (
        <div
          className={clsx(
            'pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-md transition-opacity duration-300 ease-out',
            isDragOverlayVisible || isImportingDroppedBooks ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden='true'
        >
          <div
            className='pointer-events-none absolute inset-0'
            aria-hidden='true'
            style={{
              background:
                'radial-gradient(ellipse 34% 44% at 68% 42%, rgba(182, 20, 18, 0.3) 0%, rgba(108, 10, 10, 0.18) 34%, rgba(30, 3, 4, 0.08) 58%, transparent 78%)',
            }}
          />
          <div className='relative px-6'>
            <div
              className={clsx(
                'rounded-2xl border border-[rgba(212,175,122,0.5)] bg-[rgba(8,6,6,0.78)] px-10 py-8 text-center shadow-[0_0_80px_rgba(160,20,15,0.38)] transition-all duration-300 ease-out',
                isDragOverlayVisible || isImportingDroppedBooks
                  ? 'translate-y-0 scale-100 opacity-100'
                  : 'translate-y-2 scale-[0.98] opacity-0',
              )}
            >
              <p
                className='text-3xl font-medium text-[#f3ead4]'
                style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
              >
                {isImportingDroppedBooks ? _('Importing books…') : _('Drop your books here')}
              </p>
              <p className='mt-3 text-sm text-[#b99a63]'>
                {isImportingDroppedBooks
                  ? _('Adding them to your Citadel library.')
                  : _('Release to import them into Citadel.')}
              </p>
              {!isImportingDroppedBooks && (
                <p className='mt-2 text-xs uppercase tracking-[0.16em] text-[#7f7567]'>
                  {_('EPUB, MOBI, AZW3, PDF and other supported formats')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
