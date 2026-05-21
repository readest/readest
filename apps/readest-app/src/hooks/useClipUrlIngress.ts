import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import { convertToEpubWithWorker } from '@/services/send/conversion/conversionWorker';
import { getClipOptions } from '@/services/send/clipOptions';
import { eventDispatcher } from '@/utils/event';
import { parseAnnotationDeepLink } from '@/utils/deeplink';
import { useTranslation } from './useTranslation';

/**
 * Handle "Share to Readest" article URLs from the OS share sheet
 * (Safari, Chrome, etc.). Consumes the `app-incoming-url` event published
 * by `useAppUrlIngress`, filters URLs that look like article links, and
 * runs them through the same clip → EPUB → import pipeline the `/send`
 * page uses.
 *
 * Filter rules — only act on URLs that are:
 *   - http(s) (not file://, content://, readest://, blob:, data:)
 *   - NOT an annotation deep link (those go to useOpenAnnotationLink and
 *     would otherwise be double-handled)
 *
 * Failures surface as toasts. Successful clips show "Saving article…"
 * then "Saved to your library." once `ingestFile` completes.
 *
 * Mount this hook alongside `useAppUrlIngress` (same places as
 * `useOpenWithBooks` and `useOpenAnnotationLink`) so the ingress
 * dispatcher is running when URLs arrive.
 */
export function useClipUrlIngress() {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const inflight = useRef<Set<string>>(new Set());

  const clipAndImport = useCallback(
    async (url: string) => {
      if (!appService) return;
      if (inflight.current.has(url)) return;
      inflight.current.add(url);

      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Saving article from share…'),
        timeout: 2500,
      });

      try {
        const html = await invoke<string>('clip_url', {
          url,
          options: getClipOptions(_),
        });
        const book = await convertToEpubWithWorker({ kind: 'page', html, url });
        const { library } = useLibraryStore.getState();
        const { settings } = useSettingsStore.getState();
        const ingested = await ingestFile(
          { file: book.file, books: library, forceUpload: true },
          { appService, settings, isLoggedIn: !!user },
        );
        if (!ingested) {
          throw new Error('Import produced no book');
        }
        await useLibraryStore.getState().updateBooks(envConfig, [ingested]);
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Saved “{{title}}” to your library.', {
            title: ingested.title || book.title || url,
          }),
          timeout: 3000,
        });
      } catch (err) {
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : _('Could not fetch this page');
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: detail,
          timeout: 3500,
        });
      } finally {
        inflight.current.delete(url);
      }
    },
    [_, appService, envConfig, user],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string) => {
      // iOS Share Extension forwards URLs to the main app in one of
      // two shapes — both are unwrapped to the inner article URL so
      // we can share the http(s) clip path with the Android side:
      //
      //   - Universal Link (primary):
      //       https://web.readest.com/clip?url=<encoded>
      //   - Custom URL scheme (fallback):
      //       readest://clip?url=<encoded>
      const isClipUrl =
        url.startsWith('readest://clip?') ||
        url.startsWith('readest://clip/') ||
        /^https:\/\/web\.readest\.com\/clip(?:[/?].*)?$/i.test(url);
      if (isClipUrl) {
        try {
          const inner = new URL(url).searchParams.get('url');
          if (inner) {
            url = inner;
          } else {
            return;
          }
        } catch {
          return;
        }
      }
      // Only act on http(s). file://, content://, blob: and data: belong
      // to other consumers (or aren't shareable URLs).
      if (!/^https?:\/\//i.test(url)) return;
      // Annotation deep links can come over https (web.readest.com).
      // Skip them — useOpenAnnotationLink owns that path.
      if (parseAnnotationDeepLink(url)) return;
      void clipAndImport(url);
    };

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach(handle);
    };
    eventDispatcher.on('app-incoming-url', onIncoming);

    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService, clipAndImport]);
}
