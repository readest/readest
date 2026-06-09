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
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { transferManager } from '@/services/transferManager';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { getFileExtFromMimeType } from '@/libs/document';
import { OPDSFeed, OPDSPublication, OPDSSearch, REL } from '@/types/opds';
import {
  expandOPDSSearchTemplate,
  getFileExtFromPath,
  isSearchLink,
  looksLikeXMLContent,
  MIME,
  parseMediaType,
  parseOPDSXML,
  resolveURL,
} from './utils/opdsUtils';
import {
  getProxiedURL,
  fetchWithAuth,
  probeAuth,
  needsProxy,
  probeFilename,
} from './utils/opdsReq';
import { ImportError } from '@/services/errors';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { findBookByOPDSSources, upsertOPDSSourceMapping } from '@/services/opds/sourceMap';
import { buildPseStreamFileName } from '@/services/opds/pseStream';
import type { Book } from '@/types/book';
import { FeedView } from './components/FeedView';
import { PublicationView } from './components/PublicationView';
import { SearchView } from './components/SearchView';
import { Navigation } from './components/Navigation';
import { normalizeOPDSCustomHeaders } from './utils/customHeaders';
import { closeOPDSBrowser, stashOPDSReturnTarget } from './utils/opdsClose';
import { findExistingBookForPublication } from './utils/findExistingBook';
import Dialog from '@/components/Dialog';

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
  const { appService, envConfig } = useEnv();
  const { user } = useAuth();
  const { libraryLoaded } = useLibrary();
  // Subscribe to library so the publication detail page can detect copies
  // already imported (shown as "Open & Read" instead of "Download"), and
  // re-evaluate whenever a download finishes or a book is removed.
  const library = useLibraryStore((s) => s.library);
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
  const [showAddCatalog, setShowAddCatalog] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState('');

  const searchParams = useSearchParams();
  const catalogUrl = searchParams?.get('url') || '';
  const catalogId = searchParams?.get('id') || '';
  const catalog = settings.opdsCatalogs?.find((catalog) => catalog.id === catalogId);
  const catalogSourceId = catalog?.contentId || catalogId || catalogUrl;
  // Captured once at mount so the restore effect targets exactly the
  // detail the URL described when /opds first loaded — typically after a
  // Reader → webview-back. Subsequent in-page navigation can mutate the
  // `pub` query param via handleBack/handlePublicationSelect without
  // re-triggering restoration.
  const initialPubMarkerRef = useRef<string | null>(searchParams?.get('pub') ?? null);
  const didRestorePubRef = useRef(false);
  // Remembers the (url,id) pair that the mount-load effect has already
  // kicked off a fetch for. Without this, any unrelated change to the
  // `settings` zustand store re-runs the effect, re-fetches the same
  // feed, resets viewMode to 'feed', and clobbers a publication detail
  // that the restore effect just brought back. Tracking the pair lets us
  // ignore those spurious re-runs while still honoring genuine URL/id
  // changes (e.g. an in-page navigation that mutates `catalogUrl`).
  const lastLoadedKeyRef = useRef<string | null>(null);
  const usernameRef = useRef<string | null | undefined>(undefined);
  const passwordRef = useRef<string | null | undefined>(undefined);
  const customHeadersRef = useRef<Record<string, string>>({});
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
      const map = new Map<string | undefined, Map<string, string>>();

      for (const param of search.params || []) {
        const value = formData[param.name] || '';
        const ns = param.ns ?? undefined;

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
        const customHeaders = customHeadersRef.current;
        const res = await fetchWithAuth(url, username, password, useProxy, {}, customHeaders);

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
              // router.back() (not closeOPDSBrowser) so the user can
              // resume their browser history if the catalog was just
              // temporarily down. stashOPDSReturnTarget ensures the
              // deep-link still applies when back lands on /library.
              stashOPDSReturnTarget(searchParams);
              router.back();
            }, 5000);
            throw new Error(errorMessage);
          }
        }

        const currentStartURL = startURLRef.current || url;
        const responseURL = res.url;
        const text = await res.text();

        if (looksLikeXMLContent(text)) {
          const doc = parseOPDSXML(text);
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
            const publication = getPublication(doc.documentElement) as OPDSPublication;
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
            const search = getOpenSearch(doc) as OPDSSearch;
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
              stashOPDSReturnTarget(searchParams);
              router.back();
              throw new Error(`Failed to load OPDS feed: ${res.status} ${res.statusText}`);
            }

            const link = Array.from(htmlDoc.head.querySelectorAll('link')).find((link) =>
              isOPDSCatalog(link.getAttribute('type') ?? ''),
            );

            if (!link) {
              stashOPDSReturnTarget(searchParams);
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
      const loadKey = `${catalogId}::${url}`;
      // Skip if this effect re-fires for an unrelated `settings` change
      // (zustand re-renders propagate here through the dep array). The
      // first run for a given (id,url) is the only one that should issue
      // a fetch and reset viewMode.
      if (lastLoadedKeyRef.current === loadKey) {
        return;
      }
      const catalog = settings.opdsCatalogs?.find((cat) => cat.id === catalogId);
      const { username, password } = catalog || {};
      if (username || password) {
        usernameRef.current = username;
        passwordRef.current = password;
      } else {
        usernameRef.current = null;
        passwordRef.current = null;
      }
      customHeadersRef.current = normalizeOPDSCustomHeaders(catalog?.customHeaders);
      if (libraryLoaded) {
        lastLoadedKeyRef.current = loadKey;
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
        } else if (searchLink.type === MIME.OPDS2) {
          // OPDS 2.0 JSON: href is an RFC 6570 URI template (e.g.
          // `/search{?query}`). Expand it with the typed term BEFORE resolving
          // against the base URL — resolveURL would otherwise mangle the
          // `{?query}` template braces and drop the query.
          const expandedHref = expandOPDSSearchTemplate(searchLink.href, queryTerm);
          handleNavigate(resolveURL(expandedHref, state.baseURL), true);
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
            search: (map: Map<string | undefined, Map<string, string>>) => {
              const defaultParams = map.get(undefined);
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

  const publication =
    selectedPublication && state.feed
      ? state.feed.groups?.[selectedPublication.groupIndex]?.publications?.[
          selectedPublication.itemIndex
        ] || state.feed.publications?.[selectedPublication.itemIndex]
      : state.publication;

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
          const username = usernameRef.current || '';
          const password = passwordRef.current || '';
          const customHeaders = customHeadersRef.current;
          const useProxy = needsProxy(url);
          let downloadUrl = useProxy ? getProxiedURL(url, '', true, customHeaders) : url;
          const headers: Record<string, string> = {
            'User-Agent': READEST_OPDS_USER_AGENT,
            Accept: '*/*',
            ...(!useProxy ? customHeaders : {}),
          };
          if (username || password) {
            const authHeader = await probeAuth(url, username, password, useProxy, customHeaders);
            if (authHeader) {
              if (!useProxy) {
                headers['Authorization'] = authHeader;
              }
              downloadUrl = useProxy ? getProxiedURL(url, authHeader, true, customHeaders) : url;
            }
          }

          const pathname = decodeURIComponent(new URL(url).pathname);
          const ext = getFileExtFromMimeType(parsed?.mediaType) || getFileExtFromPath(pathname);
          const basename = pathname.replaceAll('/', '_');
          const filename = ext ? `${basename}.${ext}` : basename;
          let dstFilePath = await appService?.resolveFilePath(filename, 'Cache');
          console.log('Downloading to:', url, dstFilePath);

          const responseHeaders = await downloadFile({
            appService,
            dst: dstFilePath,
            cfp: '',
            url: downloadUrl,
            headers,
            singleThreaded: true,
            skipSslVerification: true,
            onProgress,
          });
          const probedFilename = await probeFilename(responseHeaders);
          if (probedFilename) {
            const newFilePath = await appService?.resolveFilePath(probedFilename, 'Cache');
            await appService?.copyFile(dstFilePath, 'None', newFilePath, 'None');
            await appService?.deleteFile(dstFilePath, 'None');
            console.log('Renamed downloaded file to:', newFilePath);
            dstFilePath = newFilePath;
          }

          const { library, setLibrary } = useLibraryStore.getState();
          try {
            const book = await appService.importBook(dstFilePath, library);
            if (book && catalogSourceId) {
              try {
                await upsertOPDSSourceMapping(appService, {
                  catalogId: catalogSourceId,
                  sourceUrl: url,
                  bookHash: book.hash,
                });
              } catch (sourceMapError) {
                console.error('OPDS: failed to update source map:', sourceMapError);
              }
            }
            if (user && book && !book.uploadedAt && settings.autoUpload) {
              setTimeout(() => {
                transferManager.queueUpload(book);
              }, 3000);
            }
            setLibrary(library);
            appService.saveLibraryBooks(library);
            return book;
          } catch (importError) {
            console.error('Import error:', importError);
            throw new ImportError(importError);
          }
        }
      } catch (e) {
        console.error('Download error:', e);
        throw e;
      }
    },
    [user, state.baseURL, appService, libraryLoaded, settings.autoUpload, catalogSourceId],
  );

  const handleStream = useCallback(
    async (href: string, count: number, title: string, author: string) => {
      if (!appService || !libraryLoaded) return;
      try {
        const url = resolveURL(href, state.baseURL);
        const psePath = buildPseStreamFileName({ url, catalogId, count, title, author });
        const { library, setLibrary } = useLibraryStore.getState();
        const book = await appService.importBook(psePath, library, { transient: true });
        if (book) {
          setLibrary(library);
          navigateToReader(router, [book.hash]);
        }
      } catch (e) {
        console.error('Stream error:', e);
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to start stream') + `:\n${e instanceof Error ? e.message : e}`,
        });
      }
    },
    [state.baseURL, catalogId, appService, libraryLoaded, router, _],
  );

  const handleGenerateCachedImageUrl = useCallback(
    async (url: string) => {
      if (!appService) return url;
      const username = usernameRef.current || '';
      const password = passwordRef.current || '';
      const customHeaders = customHeadersRef.current;
      if (!username && !password && Object.keys(customHeaders).length === 0) {
        return needsProxy(url) ? getProxiedURL(url, '', true) : url;
      }

      const cachedKey = `img_${md5(url)}.png`;
      const cachePrefix = await appService.resolveFilePath('', 'Cache');
      const cachedPath = `${cachePrefix}/${cachedKey}`;
      if (await appService.exists(cachedPath, 'None')) {
        return await appService.getImageURL(cachedPath);
      } else {
        const useProxy = needsProxy(url);
        let downloadUrl = useProxy ? getProxiedURL(url, '', true, customHeaders) : url;
        const headers: Record<string, string> = {
          ...(!useProxy ? customHeaders : {}),
        };
        if (username || password) {
          const authHeader = await probeAuth(url, username, password, useProxy, customHeaders);
          if (authHeader) {
            if (!useProxy) {
              headers['Authorization'] = authHeader;
            }
            downloadUrl = useProxy ? getProxiedURL(url, authHeader, true, customHeaders) : url;
          }
        }
        await downloadFile({
          appService,
          dst: cachedPath,
          cfp: '',
          url: downloadUrl,
          singleThreaded: true,
          skipSslVerification: true,
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
      // Strip the publication marker when stepping back to a non-publication
      // view, otherwise a later remount (from Reader → webview back) would
      // think we should restore a stale detail view that no longer matches.
      if (!entry.selectedPublication) {
        newURL.searchParams.delete('pub');
      } else {
        newURL.searchParams.set(
          'pub',
          `${entry.selectedPublication.groupIndex}:${entry.selectedPublication.itemIndex}`,
        );
      }
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
      // Keep the URL pub marker in sync with the entry we're forwarding to,
      // mirroring handleBack so mount-restore stays correct.
      if (!entry.selectedPublication) {
        newURL.searchParams.delete('pub');
      } else {
        newURL.searchParams.set(
          'pub',
          `${entry.selectedPublication.groupIndex}:${entry.selectedPublication.itemIndex}`,
        );
      }
      window.history.replaceState({}, '', newURL.toString());
    }
  }, [history, historyIndex]);

  const handlePublicationSelect = useCallback(
    (groupIndex: number, itemIndex: number, options: { skipUrlPush?: boolean } = {}) => {
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

      // Reflect the open publication in the browser URL so a later
      // router.push('/reader') leaves a recoverable entry behind us in the
      // webview history. When Android Back returns here from the reader,
      // /opds remounts with `pub=<gi>:<ii>` and the mount-restore effect
      // below puts us straight back on the detail view instead of dropping
      // the user on the bare feed list. Skip when called from the restore
      // path itself (URL already carries the param) to avoid stacking a
      // duplicate history entry.
      if (!options.skipUrlPush) {
        const newURL = new URL(window.location.href);
        newURL.searchParams.set('pub', `${groupIndex}:${itemIndex}`);
        window.history.pushState({}, '', newURL.toString());
      }
    },
    [],
  );

  // Mount-time restore: when /opds remounts with `?pub=<gi>:<ii>` in the
  // URL (typically because the user pressed Android Back inside the Reader
  // they had launched from a publication detail), wait for the feed to
  // finish loading then jump straight back to that detail view. Without
  // this, the user would be dropped on the book list and lose their place,
  // and the back-key hook would treat the catalog root as already at the
  // bottom of in-page history.
  useEffect(() => {
    if (didRestorePubRef.current) return;
    if (!initialPubMarkerRef.current) return;
    if (viewMode !== 'feed' || !state.feed) return;

    const [giStr, iiStr] = initialPubMarkerRef.current.split(':');
    const groupIndex = Number(giStr);
    const itemIndex = Number(iiStr);
    if (Number.isNaN(groupIndex) || Number.isNaN(itemIndex)) {
      didRestorePubRef.current = true;
      return;
    }

    const pub =
      state.feed.groups?.[groupIndex]?.publications?.[itemIndex] ||
      state.feed.publications?.[itemIndex];
    if (!pub) {
      // Feed shape no longer matches the stale marker — drop the URL flag
      // so subsequent in-page navigation doesn't keep trying to restore.
      didRestorePubRef.current = true;
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete('pub');
      window.history.replaceState({}, '', cleaned.toString());
      return;
    }

    didRestorePubRef.current = true;
    handlePublicationSelect(groupIndex, itemIndex, { skipUrlPush: true });
  }, [viewMode, state.feed, handlePublicationSelect]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // Android Back / Esc inside the OPDS browser: step back through the
  // browser's own in-page history first (drilled into a sub-feed, opened a
  // publication detail, ran a search). Only when we're already at the root
  // of *this* catalog (no internal history to pop) do we close the browser
  // and return to /library — with `?opds=true` so the standalone OPDS
  // catalogs dialog re-opens, matching where the user came from.
  //
  // Without this hook, Android Back falls through to the webview's default
  // history-back, which racing with React's unmount of /library makes the
  // OPDS catalogs dialog disappear before /library re-mounts, so the user
  // perceives two Back presses to dismiss "the whole OPDS page". The
  // CatalogDialog rendered on /library also acquires its own
  // `native-key-down` listener while mounted, and once /opds takes over
  // there's nothing here to consume Back in its place — this hook fills
  // that gap.
  //
  // `useKeyDownActions` registers `handleKeyDown` once with a stale
  // `onCancel` closure (its useEffect deps don't include onCancel), so we
  // route through a ref that always points at the latest handler. Without
  // this indirection the hook would forever see the first render's
  // `canGoBack=false` and skip straight to closing the browser even after
  // the user drilled into a sub-feed.
  const backOrCloseRef = useRef<() => void>(() => {});
  backOrCloseRef.current = () => {
    if (historyIndexRef.current > 0) {
      handleBack();
    } else {
      stashOPDSReturnTarget(searchParams);
      closeOPDSBrowser(router, searchParams);
    }
  };
  useKeyDownActions({
    onCancel: () => backOrCloseRef.current(),
  });

  const [existingBookForPublication, setExistingBookForPublication] = useState<Book | null>(null);

  useEffect(() => {
    let cancelled = false;

    const metadataMatch = libraryLoaded
      ? findExistingBookForPublication(publication, library)
      : null;
    setExistingBookForPublication(metadataMatch);

    const sourceUrls =
      publication?.links
        .filter((link) => {
          const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
          return link.href && rels.some((rel) => rel.startsWith(REL.ACQ));
        })
        .map((link) => resolveURL(link.href!, state.baseURL)) ?? [];

    if (libraryLoaded && appService && catalogSourceId && sourceUrls.length > 0) {
      void findBookByOPDSSources(appService, {
        catalogId: catalogSourceId,
        sourceUrls,
        library,
      }).then((book) => {
        if (!cancelled && book) setExistingBookForPublication(book);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [appService, catalogSourceId, publication, state.baseURL, library, libraryLoaded]);

  const handleOpenAddCatalog = useCallback(() => {
    const defaultName =
      state.feed?.metadata?.title || state.search?.metadata?.title || _('New Catalog');
    const prefix = catalog?.name ? `${catalog.name} - ` : '';
    setNewCatalogName(`${prefix}${defaultName}`);
    setShowAddCatalog(true);
  }, [state.feed, state.search, catalog, _]);

  const handleConfirmAddCatalog = useCallback(() => {
    if (!newCatalogName.trim()) return;

    if (useCustomOPDSStore.getState().findByUrl(state.currentURL)) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Catalog already in My Catalogs'),
        timeout: 2500,
      });
      setShowAddCatalog(false);
      return;
    }

    useCustomOPDSStore.getState().addCatalog({
      id: Date.now().toString(),
      name: newCatalogName.trim(),
      url: state.currentURL,
      username: usernameRef.current || undefined,
      password: passwordRef.current || undefined,
      customHeaders: customHeadersRef.current,
      autoDownload: catalog?.autoDownload || false,
    });

    useCustomOPDSStore.getState().saveCustomOPDSCatalogs(envConfig);

    eventDispatcher.dispatch('toast', {
      type: 'success',
      message: _('Catalog added successfully'),
      timeout: 2500,
    });

    setShowAddCatalog(false);
  }, [newCatalogName, state.currentURL, catalog, envConfig, _]);

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
          feed={state.feed}
          baseURL={state.baseURL}
          resolveURL={resolveURL}
          onNavigate={handleNavigate}
          onAddCatalog={handleOpenAddCatalog}
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
            onAddCatalog={handleOpenAddCatalog}
          />
        )}

        {viewMode === 'publication' && publication && (
          <PublicationView
            publication={publication}
            baseURL={state.baseURL}
            existingBook={existingBookForPublication}
            onDownload={handleDownload}
            onStream={handleStream}
            resolveURL={resolveURL}
            onNavigate={handleNavigate}
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

      <Dialog
        isOpen={showAddCatalog}
        title={_('Add to My Catalogs')}
        onClose={() => setShowAddCatalog(false)}
        boxClassName='sm:max-w-md sm:h-auto'
        contentClassName='!px-6 !py-4'
      >
        <div className='flex flex-col gap-4 pt-2'>
          <div className='form-control'>
            <label className='label'>
              <span className='label-text font-medium text-sm'>{_('Catalog Name')}</span>
            </label>
            <input
              type='text'
              value={newCatalogName}
              onChange={(e) => setNewCatalogName(e.target.value)}
              className='input input-bordered eink-bordered w-full'
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCatalogName.trim()) {
                  e.preventDefault();
                  handleConfirmAddCatalog();
                }
              }}
            />
          </div>
          <div className='mt-2 flex justify-end gap-2'>
            <button className='btn btn-ghost btn-sm' onClick={() => setShowAddCatalog(false)}>
              {_('Cancel')}
            </button>
            <button
              className='btn btn-primary btn-sm'
              onClick={handleConfirmAddCatalog}
              disabled={!newCatalogName.trim()}
            >
              {_('Save')}
            </button>
          </div>
        </div>
      </Dialog>

      <Toast />
    </div>
  );
}
