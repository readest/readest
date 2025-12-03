'use client';

import clsx from 'clsx';
import { md5 } from 'js-md5';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isOPDSCatalog, getPublication, getFeed, getOpenSearch } from 'foliate-js/opds.js';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { isWebAppPlatform } from '@/services/environment';
import { downloadFile } from '@/libs/storage';
import { Toast } from '@/components/Toast';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { eventDispatcher } from '@/utils/event';
import { getFileExtFromMimeType } from '@/libs/document';
import { OPDSFeed, OPDSPublication, OPDSSearch } from '@/types/opds';
import { MIME, parseMediaType, resolveURL } from './utils/opdsUtils';
import { getProxiedURL, fetchWithAuth, probeAuth, needsProxy } from './utils/opdsReq';
import { FeedView } from './components/FeedView';
import { PublicationView } from './components/PublicationView';
import { SearchView } from './components/SearchView';
import { Navigation } from './components/Navigation';

type ViewMode = 'feed' | 'publication' | 'search' | 'loading' | 'error';

interface OPDSState {
  feed?: OPDSFeed;
  publication?: OPDSPublication;
  search?: OPDSSearch;
  baseURL: string;
  currentURL: string;
  startURL?: string;
}

interface HistoryEntry {
  url: string;
  state: OPDSState;
  viewMode: ViewMode;
  selectedPublication: { groupIndex: number; itemIndex: number } | null;
}

export default function BrowserPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { libraryLoaded } = useLibrary();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { settings } = useSettingsStore();
  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [state, setState] = useState<OPDSState>({
    baseURL: '',
    currentURL: '',
  });
  const [selectedPublication, setSelectedPublication] = useState<{
    groupIndex: number;
    itemIndex: number;
  } | null>(null);

  const [error, setError] = useState<Error | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const searchParams = useSearchParams();
  const usernameRef = useRef<string | null | undefined>(undefined);
  const passwordRef = useRef<string | null | undefined>(undefined);
  const startURLRef = useRef<string | null | undefined>(undefined);
  const loadingOPDSRef = useRef(false);
  const historyIndexRef = useRef(-1);
  const isNavigatingHistoryRef = useRef(false);

  useTheme({ systemUIVisible: false });

  // Keep refs in sync with state
  useEffect(() => {
    startURLRef.current = state.startURL;
  }, [state.startURL]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const addToHistory = useCallback(
    (
      url: string,
      newState: OPDSState,
      viewMode: ViewMode,
      selectedPub: { groupIndex: number; itemIndex: number } | null = null,
    ) => {
      const newEntry: HistoryEntry = {
        url,
        state: newState,
        viewMode,
        selectedPublication: selectedPub,
      };
      setHistory((prev) => [...prev.slice(0, historyIndexRef.current + 1), newEntry]);
      setHistoryIndex((prev) => prev + 1);
    },
    [],
  );

  const loadOPDS = useCallback(
    async (url: string, skipHistory = false) => {
      if (loadingOPDSRef.current) return;
      loadingOPDSRef.current = true;

      setViewMode('loading');
      setError(null);

      try {
        const useProxy = isWebAppPlatform();
        const username = usernameRef.current || '';
        const password = passwordRef.current || '';
        const res = await fetchWithAuth(url, username, password, useProxy);

        if (!res.ok) {
          eventDispatcher.dispatch('toast', {
            message: `Failed to load OPDS feed: ${res.status} ${res.statusText}`,
            timeout: 5000,
            type: 'error',
          });
          setTimeout(() => {
            router.back();
          }, 5000);
          throw new Error(`Failed to load OPDS feed: ${res.status} ${res.statusText}`);
        }

        const currentStartURL = startURLRef.current || url;
        const responseURL = res.url;
        const text = await res.text();

        if (text.startsWith('<')) {
          const doc = new DOMParser().parseFromString(text, MIME.XML as DOMParserSupportedType);
          const {
            documentElement: { localName },
          } = doc;

          if (localName === 'feed') {
            const feed = getFeed(doc) as OPDSFeed;
            const newState = {
              feed,
              baseURL: responseURL,
              currentURL: url,
              startURL: currentStartURL || responseURL,
            };
            setState(newState);
            setViewMode('feed');
            setSelectedPublication(null);
            if (!skipHistory) {
              addToHistory(url, newState, 'feed', null);
            }
          } else if (localName === 'entry') {
            const publication = getPublication(doc.documentElement);
            const newState = {
              publication,
              baseURL: responseURL,
              currentURL: url,
              startURL: currentStartURL || responseURL,
            };
            setState(newState);
            setViewMode('publication');
            setSelectedPublication(null);

            if (!skipHistory) {
              addToHistory(url, newState, 'publication', null);
            }
          } else if (localName === 'OpenSearchDescription') {
            const search = getOpenSearch(doc);
            const newState = {
              search,
              baseURL: responseURL,
              currentURL: url,
              startURL: currentStartURL || responseURL,
            };
            setState(newState);
            setViewMode('search');
            setSelectedPublication(null);

            if (!skipHistory) {
              addToHistory(url, newState, 'search', null);
            }
          } else {
            const contentType = res.headers.get('Content-Type') ?? MIME.HTML;
            const type = parseMediaType(contentType)?.mediaType ?? MIME.HTML;
            const htmlDoc = new DOMParser().parseFromString(text, type as DOMParserSupportedType);

            if (!htmlDoc.head) {
              router.back();
              throw new Error(`Failed to load OPDS feed: ${res.status} ${res.statusText}`);
            }

            const link = Array.from(htmlDoc.head.querySelectorAll('link')).find((link) =>
              isOPDSCatalog(link.getAttribute('type') ?? ''),
            );

            if (!link) {
              router.back();
              throw new Error('Document has no link to OPDS feeds');
            }

            const href = link.getAttribute('href');
            if (href) {
              const resolvedURL = resolveURL(href, responseURL);
              loadOPDS(resolvedURL);
            }
          }
        } else {
          const feed = JSON.parse(text);
          const newState = {
            feed,
            baseURL: responseURL,
            currentURL: url,
            startURL: currentStartURL || responseURL,
          };
          setState(newState);
          setViewMode('feed');
          setSelectedPublication(null);

          if (!skipHistory) {
            addToHistory(url, newState, 'feed', null);
          }
        }
      } catch (e) {
        console.error(e);
        setError(e as Error);
        setViewMode('error');
      } finally {
        loadingOPDSRef.current = false;
      }
    },
    [router, addToHistory],
  );

  useEffect(() => {
    const url = searchParams?.get('url');
    if (url && !isNavigatingHistoryRef.current) {
      const catalogId = searchParams?.get('id') || '';
      const catalog = settings.opdsCatalogs?.find((cat) => cat.id === catalogId);
      const { username, password } = catalog || {};
      if (username || password) {
        usernameRef.current = username;
        passwordRef.current = password;
      } else {
        usernameRef.current = null;
        passwordRef.current = null;
      }
      if (libraryLoaded) {
        loadOPDS(url);
      }
    } else if (isNavigatingHistoryRef.current) {
      isNavigatingHistoryRef.current = false;
    } else {
      setViewMode('error');
      setError(new Error('No OPDS URL provided'));
    }
  }, [searchParams, settings, libraryLoaded, loadOPDS]);

  const handleNavigate = useCallback(
    (url: string) => {
      const newURL = new URL(window.location.href);
      newURL.searchParams.set('url', url);
      window.history.pushState({}, '', newURL.toString());
      loadOPDS(url);
    },
    [loadOPDS],
  );

  const handleDownload = useCallback(
    async (
      href: string,
      type?: string,
      onProgress?: (progress: { progress: number; total: number }) => void,
    ) => {
      if (!appService || !libraryLoaded) return;
      try {
        const url = resolveURL(href, state.baseURL);
        const parsed = parseMediaType(type);
        if (parsed?.mediaType === MIME.HTML) {
          if (isWebAppPlatform()) {
            window.open(url, '_blank');
          } else {
            await openUrl(url);
          }
          return;
        } else {
          const ext = parsed?.mediaType ? getFileExtFromMimeType(parsed.mediaType) : '';
          const basename = new URL(url).pathname.replaceAll('/', '_');
          const filename = ext ? `${basename}.${ext}` : basename;
          const dstFilePath = await appService?.resolveFilePath(filename, 'Cache');
          if (dstFilePath) {
            const username = usernameRef.current || '';
            const password = passwordRef.current || '';
            const useProxy = needsProxy(url);
            let downloadUrl = useProxy ? getProxiedURL(url, '', true) : url;
            const headers: Record<string, string> = {
              'User-Agent': 'Readest/1.0 (OPDS Browser)',
            };
            if (username || password) {
              const authHeader = await probeAuth(url, username, password, useProxy);
              if (authHeader) {
                headers['Authorization'] = authHeader;
                downloadUrl = useProxy ? getProxiedURL(url, authHeader, true) : url;
              }
            }

            await downloadFile({
              appService,
              dst: dstFilePath,
              cfp: '',
              url: downloadUrl,
              headers,
              singleThreaded: true,
              onProgress,
            });
            const { library, setLibrary } = useLibraryStore.getState();
            const book = await appService.importBook(dstFilePath, library);
            setLibrary(library);
            appService.saveLibraryBooks(library);
            return book;
          }
        }
      } catch (e) {
        console.error('Download error:', e);
        throw e;
      }
      return;
    },
    [state.baseURL, appService, libraryLoaded],
  );

  const handleGenerateCachedImageUrl = useCallback(
    async (url: string) => {
      if (!appService) return url;
      const username = usernameRef.current || '';
      const password = passwordRef.current || '';
      if (!username && !password) {
        return url;
      }

      const cachedKey = `img_${md5(url)}.png`;
      const cachePrefix = await appService.resolveFilePath('', 'Cache');
      const cachedPath = `${cachePrefix}/${cachedKey}`;
      if (await appService.exists(cachedPath, 'None')) {
        return await appService.getImageURL(cachedPath);
      } else {
        const useProxy = needsProxy(url);
        let downloadUrl = useProxy ? getProxiedURL(url, '', true) : url;
        const headers: Record<string, string> = {};
        if (username || password) {
          const authHeader = await probeAuth(url, username, password, useProxy);
          if (authHeader) {
            headers['Authorization'] = authHeader;
            downloadUrl = useProxy ? getProxiedURL(url, authHeader, true) : url;
          }
        }
        await downloadFile({
          appService,
          dst: cachedPath,
          cfp: '',
          url: downloadUrl,
          singleThreaded: true,
          headers,
        });
        return await appService.getImageURL(cachedPath);
      }
    },
    [appService],
  );

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const entry = history[newIndex];
      if (!entry) return;

      isNavigatingHistoryRef.current = true;
      setHistoryIndex(newIndex);
      setState(entry.state);
      setViewMode(entry.viewMode);
      setSelectedPublication(entry.selectedPublication);

      const newURL = new URL(window.location.href);
      newURL.searchParams.set('url', entry.url);
      window.history.replaceState({}, '', newURL.toString());
    }
  }, [history, historyIndex]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const entry = history[newIndex];
      if (!entry) return;

      isNavigatingHistoryRef.current = true;
      setHistoryIndex(newIndex);
      setState(entry.state);
      setViewMode(entry.viewMode);
      setSelectedPublication(entry.selectedPublication);

      const newURL = new URL(window.location.href);
      newURL.searchParams.set('url', entry.url);
      window.history.replaceState({}, '', newURL.toString());
    }
  }, [history, historyIndex]);

  const handlePublicationSelect = useCallback((groupIndex: number, itemIndex: number) => {
    setSelectedPublication({ groupIndex, itemIndex });
    setViewMode('publication');

    // Add this publication view to history
    setHistory((prev) => {
      const currentEntry = prev[historyIndexRef.current];
      if (!currentEntry) return prev;

      const newEntry: HistoryEntry = {
        url: currentEntry.url,
        state: currentEntry.state,
        viewMode: 'publication',
        selectedPublication: { groupIndex, itemIndex },
      };

      return [...prev.slice(0, historyIndexRef.current + 1), newEntry];
    });
    setHistoryIndex((prev) => prev + 1);
  }, []);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const publication =
    selectedPublication && state.feed
      ? state.feed.groups?.[selectedPublication.groupIndex]?.publications?.[
          selectedPublication.itemIndex
        ] || state.feed.publications?.[selectedPublication.itemIndex]
      : state.publication;

  return (
    <div
      className={clsx(
        'bg-base-100 flex h-screen select-none flex-col',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <Navigation
          currentURL={state.currentURL}
          startURL={state.startURL}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />
      </div>
      <main className='flex-1 overflow-auto'>
        {viewMode === 'loading' && (
          <div className='flex h-full items-center justify-center'>
            <div className='text-center'>
              <div className='loading loading-spinner loading-lg mb-4'></div>
              <h1 className='text-base font-semibold'>{_('Loading...')}</h1>
            </div>
          </div>
        )}

        {viewMode === 'error' && (
          <div className='flex h-full items-center justify-center'>
            <div className='max-w-md text-center'>
              <h1 className='text-error mb-4 text-xl font-bold'>{_('Cannot Load Page')}</h1>
              <p className='text-base-content/70 mb-4'>
                {error?.message || _('An error occurred')}
              </p>
              <button className='btn btn-primary' onClick={() => window.location.reload()}>
                {_('Reload Page')}
              </button>
            </div>
          </div>
        )}

        {viewMode === 'feed' && state.feed && (
          <FeedView
            feed={state.feed}
            baseURL={state.baseURL}
            onNavigate={handleNavigate}
            onPublicationSelect={handlePublicationSelect}
            resolveURL={resolveURL}
            onGenerateCachedImageUrl={handleGenerateCachedImageUrl}
            isOPDSCatalog={isOPDSCatalog}
          />
        )}

        {viewMode === 'publication' && publication && (
          <PublicationView
            publication={publication}
            baseURL={state.baseURL}
            onDownload={handleDownload}
            resolveURL={resolveURL}
            onGenerateCachedImageUrl={handleGenerateCachedImageUrl}
          />
        )}

        {viewMode === 'search' && state.search && (
          <SearchView
            search={state.search}
            baseURL={state.baseURL}
            onNavigate={handleNavigate}
            resolveURL={resolveURL}
          />
        )}
      </main>
      <Toast />
    </div>
  );
}
