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

interface ClipOptions {
  groupId?: string;
  groupName?: string;
}

interface PendingShareSave {
  url: string;
  groupId?: string | null;
  groupName?: string | null;
  addedAt?: string;
}

/**
 * Handle "Share to Readest" article URLs from the OS share sheet
 * (Safari, Chrome, etc.). Two paths feed in:
 *
 *   1. Deep-link wake-up (`app-incoming-url` event published by
 *      `useAppUrlIngress`) — filters URLs that look like article links
 *      and runs them through the clip → EPUB → import pipeline.
 *
 *   2. iOS Share-Extension App Group queue — the extension writes
 *      `{url, groupId?, groupName?}` payloads into the shared
 *      NSUserDefaults at `group.com.bilingify.readest`, and the host
 *      plugin (NativeBridgePlugin) drains them on foreground by calling
 *      `window.__readestOnShareExtensionPending(saves)`. Same ingest
 *      pipeline, but the chosen library group is preserved.
 *
 * On iOS we also expose `window.__readestGetGroups()` so the
 * Share-Extension picker can show up-to-date library groups, and we
 * post a `{type:'ready'}` to the WKScriptMessageHandler the plugin
 * registered, so the cold-start drain happens even when the extension
 * woke the app up before this hook had mounted.
 *
 * Filter rules — only act on URLs that are:
 *   - http(s) (not file://, content://, readest://, blob:, data:)
 *   - NOT an annotation deep link (those go to useOpenAnnotationLink)
 *
 * Failures surface as toasts. Successful clips show "Saving article…"
 * then "Saved to your library." once `ingestFile` completes.
 */
export function useClipUrlIngress() {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const inflight = useRef<Set<string>>(new Set());

  const clipAndImport = useCallback(
    async (url: string, options: ClipOptions = {}) => {
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
        if (options.groupId) ingested.groupId = options.groupId;
        if (options.groupName) ingested.groupName = options.groupName;
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

  // Deep-link path (existing).
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

  // iOS Share-Extension App Group bridge.
  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    if (typeof window === 'undefined') return;

    const w = window as unknown as {
      __readestGetGroups?: () => {
        groups: { id: string; name: string }[];
        defaultGroupName: string;
      };
      __readestOnShareExtensionPending?: (saves: PendingShareSave[]) => boolean;
      webkit?: {
        messageHandlers?: {
          readestShareBridge?: { postMessage: (msg: { type: string }) => void };
        };
      };
    };

    // The Share Extension is a native UIKit module and can't read the web
    // app's i18next catalogue. We pass it the user-locale-translated
    // string for "Default" (the no-group entry) alongside the groups —
    // saves maintaining a parallel iOS .strings file just for one phrase.
    w.__readestGetGroups = () => {
      try {
        return {
          groups: useLibraryStore.getState().getGroups(),
          defaultGroupName: _('Default'),
        };
      } catch {
        return { groups: [], defaultGroupName: 'Default' };
      }
    };

    w.__readestOnShareExtensionPending = (saves) => {
      if (!Array.isArray(saves)) return false;
      for (const save of saves) {
        if (!save || typeof save.url !== 'string') continue;
        void clipAndImport(save.url, {
          groupId: save.groupId ?? undefined,
          groupName: save.groupName ?? undefined,
        });
      }
      return true;
    };

    // Tell the plugin we're mounted so it can drain any pending saves
    // queued before the hook was alive (cold-start path).
    try {
      w.webkit?.messageHandlers?.readestShareBridge?.postMessage({ type: 'ready' });
    } catch {
      // Non-iOS or handler not registered — no-op.
    }

    return () => {
      const cleanup = window as unknown as {
        __readestGetGroups?: unknown;
        __readestOnShareExtensionPending?: unknown;
      };
      delete cleanup.__readestGetGroups;
      delete cleanup.__readestOnShareExtensionPending;
    };
  }, [appService, clipAndImport]);
}
