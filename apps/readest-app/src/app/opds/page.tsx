'use client';

import clsx from 'clsx';
import { md5 } from 'js-md5';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isOPDSCatalog, getPublication, getFeed, getOpenSearch } from 'foliate-js/opds.js';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { isWebAppPlatform } from '@/services/environment';
import { downloadFile } from '@/libs/storage';
import { Toast } from '@/components/Toast';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { transferManager } from '@/services/transferManager';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { eventDispatcher } from '@/utils/event';
import { getFileExtFromMimeType } from '@/libs/document';
import { OPDSFeed, OPDSPublication, OPDSSearch } from '@/types/opds';
import {
  getFileExtFromPath,
  isSearchLink,
  MIME,
  parseMediaType,
  resolveURL,
} from './utils/opdsUtils';
import { getProxiedURL, fetchWithAuth, probeAuth, needsProxy } from './utils/opdsReq';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
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
  const { user } = useAuth();
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
  const catalogUrl = searchParams?.get('url') || '';
  const catalogId = searchParams?.get('id') || '';
  const usernameRef = useRef<string | null | undefined>(undefined);
  const passwordRef = useRef<string | null | undefined>(undefined);
  const startURLRef = useRef<string | null | undefined>(undefined);
  const loadingOPDSRef = useRef(false);
  const historyIndexRef = useRef(-1);
  const isNavigatingHistoryRef = useRef(false);
  const searchTermRef = useRef('');

  useTheme({ systemUIVisible: false });
  useTransferQueue(libraryLoaded);

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

  const quickSearch = useCallback((search: OPDSSearch, baseURL: string, searchTerms: string) => {
    if (searchTerms) {
      const formData: Record<string, string> = {};
      search.params?.forEach((param) => {
        if (param.name === 'count') {
          formData[param.name] = '20';
        } else if (param.name === 'startPage') {
          formData[param.name] = '1';
        } else if (param.name === 'searchTerms') {
          formData[param.name] = searchTerms;
        } else {
          formData[param.name] = param.value || '';
        }
      });
      const map = new Map<string | null, Map<string | null, string>>();

      for (const param of search.params || []) {
        const value = formData[param.name] || '';
        const ns = param.ns ?? null;

        if (map.has(ns)) {
          map.get(ns)!.set(param.name, value);
        } else {
          map.set(ns, new Map([[param.name, value]]));
        }
      }

      const searchURL = search.search(map);
      const resolvedURL = resolveURL(searchURL, baseURL);
      handleNavigate(resolvedURL, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOPDS = useCallback(
    async (url: string, options: { skipHistory?: boolean; isSearch?: boolean } = {}) => {
      const { skipHistory = false, isSearch = false } = options;

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
          if (isSearch && res.status === 404) {
            const warnMessage = _('No search results found');
            eventDispatcher.dispatch('toast', {
              message: warnMessage,
              timeout: 2000,
              type: 'warning',
            });
            setViewMode('search');
            return;
          } else {
            const errorMessage = _('Failed to load OPDS feed: {{status}} {{statusText}}', {
              status: res.status,
              statusText: res.statusText,
            });
            eventDispatcher.dispatch('toast', {
              message: errorMessage,
              timeout: 5000,
              type: 'error',
            });
            setTimeout(() => {
              router.back();
            }, 5000);
            throw new Error(errorMessage);
          }
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
            if (searchTermRef.current) {
              quickSearch(search, responseURL, searchTermRef.current);
            } else {
              setViewMode('search');
              setSelectedPublication(null);
            }
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
    [_, router, quickSearch, addToHistory],
  );

  useEffect(() => {
    const url = catalogUrl;
    if (url && !isNavigatingHistoryRef.current) {
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
  }, [catalogUrl, catalogId, settings, libraryLoaded, loadOPDS]);

  const handleNavigate = useCallback(
    (url: string, isSearch = false) => {
      const newURL = new URL(window.location.href);
      newURL.searchParams.set('url', url);
      window.history.pushState({}, '', newURL.toString());
      loadOPDS(url, { isSearch });
    },
    [loadOPDS],
  );

  const hasSearch = useMemo(() => {
    return !!state.feed?.links?.find(isSearchLink);
  }, [state.feed]);

  const handleGoStart = useCallback(() => {
    if (startURLRef.current) {
      handleNavigate(startURLRef.current);
    }
    searchTermRef.current = '';
  }, [startURLRef, handleNavigate]);

  const handleSearch = useCallback(
    (queryTerm: string) => {
      if (!state.feed) return;

      searchTermRef.current = queryTerm;

      const searchLink = state.feed.links?.find(isSearchLink);
      if (searchLink && searchLink.href) {
        const searchURL = resolveURL(searchLink.href, state.baseURL);
        if (searchLink.type === MIME.OPENSEARCH) {
          handleNavigate(searchURL, true);
        } else if (searchLink.type === MIME.ATOM) {
          const search: OPDSSearch = {
            metadata: {
              title: _('Search'),
              description: state.feed.metadata?.title
                ? _('Search in {{title}}', { title: state.feed.metadata.title })
                : undefined,
            },
            params: [
              {
                name: 'searchTerms',
                required: true,
              },
            ],
            search: (map: Map<string | null, Map<string | null, string>>) => {
              const defaultParams = map.get(null);
              const searchTerms = defaultParams?.get('searchTerms') || '';
              const decodedURL = decodeURIComponent(searchURL);
              return decodedURL.replace('{searchTerms}', encodeURIComponent(searchTerms));
            },
          };
          const newState: OPDSState = {
            feed: state.feed,
            search,
            baseURL: state.baseURL,
            currentURL: state.currentURL,
            startURL: state.startURL,
          };
          setState(newState);
          setSelectedPublication(null);
          setViewMode('search');
          addToHistory(state.currentURL, newState, 'search', null);
        }
      }
    },
    [_, state, handleNavigate, addToHistory],
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
          const pathname = new URL(url).pathname;
          const ext = getFileExtFromMimeType(parsed?.mediaType) || getFileExtFromPath(pathname);
          const basename = pathname.replaceAll('/', '_');
          const filename = ext ? `${basename}.${ext}` : basename;
          const dstFilePath = await appService?.resolveFilePath(filename, 'Cache');
          if (dstFilePath) {
            const username = usernameRef.current || '';
            const password = passwordRef.current || '';
            const useProxy = needsProxy(url);
            let downloadUrl = useProxy ? getProxiedURL(url, '', true) : url;
            const headers: Record<string, string> = {
              'User-Agent': READEST_OPDS_USER_AGENT,
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
            if (user && book && !book.uploadedAt && settings.autoUpload) {
              setTimeout(() => {
                transferManager.queueUpload(book);
              }, 3000);
            }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, state.baseURL, appService, libraryLoaded],
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
          searchTerm={searchTermRef.current}
          onBack={handleBack}
          onForward={handleForward}
          onGoStart={handleGoStart}
          onSearch={handleSearch}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          hasSearch={hasSearch}
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
