import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ingestFile } from '@/services/ingestService';
import {
  isSupportedBookDownload,
  setWebBrowserStatus,
  subscribeWebBrowserDownloads,
  type WebBrowserDownload,
} from '@/services/webBrowser/webBrowser';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from './useTranslation';

/**
 * Imports files downloaded inside the in-app web browser (#5775) and
 * mirrors the outcome into the browser's chrome. Mount once in the
 * library page, next to `useClipUrlIngress`.
 */
export function useWebBrowserDownloads() {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const handleDownload = useCallback(
    async (download: WebBrowserDownload) => {
      if (!appService) return;
      const { filename } = download;
      if (!download.success) {
        await setWebBrowserStatus({ state: 'failed', filename });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: download.error || _('Download failed'),
          timeout: 3500,
        });
        return;
      }
      if (!isSupportedBookDownload(filename)) {
        await setWebBrowserStatus({ state: 'unsupported', filename });
        return;
      }
      await setWebBrowserStatus({ state: 'importing', filename });
      try {
        const { library } = useLibraryStore.getState();
        const { settings } = useSettingsStore.getState();
        const groupId = searchParams?.get('group') || undefined;
        const groupName = groupId
          ? library.find((b) => b.groupId === groupId)?.groupName
          : undefined;
        const book = await ingestFile(
          { file: download.path, books: library, groupId, groupName },
          { appService, settings, isLoggedIn: !!user },
        );
        if (!book) throw new Error(_('Import produced no book'));
        await useLibraryStore.getState().updateBooks(envConfig, [book]);
        await setWebBrowserStatus({ state: 'added', filename, bookHash: book.hash });
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Saved “{{title}}” to your library.', { title: book.title || filename }),
          timeout: 3000,
        });
      } catch (err) {
        await setWebBrowserStatus({ state: 'failed', filename });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: err instanceof Error ? err.message : _('Import failed'),
          timeout: 3500,
        });
      }
    },
    [appService, envConfig, user, searchParams, _],
  );

  // Register once per appService; dispatch to the latest handler.
  const handlerRef = useRef(handleDownload);
  handlerRef.current = handleDownload;

  useEffect(() => {
    if (!appService) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    subscribeWebBrowserDownloads(!!appService.isMobileApp, (download) => {
      void handlerRef.current(download);
    })
      .then((fn) => {
        if (cancelled) fn();
        else dispose = fn;
      })
      .catch((err) => {
        // Without the listener, downloads would never reach the library. This is a
        // rare internal failure; log it and avoid an unhandled promise rejection.
        console.warn('[browser] failed to subscribe to web browser downloads', err);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [appService]);
}
