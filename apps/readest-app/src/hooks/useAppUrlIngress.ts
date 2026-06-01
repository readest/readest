import { useEffect, useRef } from 'react';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface OpenFilesPayload {
  files: string[];
}

interface SharedIntentPayload {
  urls: string[];
  /**
   * Android-only. Distinguishes "Open with Readest" (`VIEW` — the user
   * tapped a file in their file browser and chose Readest) from "Send to
   * Readest" (`SEND` / `SEND_MULTIPLE` — share-sheet capture). We forward
   * it on the `app-incoming-url` event so consumers can pick the right
   * import strategy: VIEW should open the file directly without writing
   * it to the library, SEND should ingest it like a sync capture.
   */
  action?: 'VIEW' | 'SEND';
}

/**
 * Single ingress point for incoming URLs from the operating system.
 *
 * Subscribes to every Tauri channel that can deliver a URL on any platform:
 *   - `single-instance` event  — Win/Linux deep link, macOS open-file
 *   - `open-files` event       — macOS in-app open-files
 *   - `shared-intent` plugin   — Android "Share to Readest" intent
 *   - `onOpenUrl`              — iOS / Android / macOS via Tauri v2
 *
 * Re-broadcasts every URL list as the `app-incoming-url` event. Consumers
 * subscribe to the event instead of the underlying channels, which:
 *   - decouples them from platform specifics
 *   - sidesteps a Tauri Android quirk where multiple `onOpenUrl`
 *     subscribers don't all fire
 *   - keeps the channel-subscription code in exactly one place
 *
 * Existing consumers:
 *   - `useOpenWithBooks`        — file imports
 *   - `useOpenAnnotationLink`   — annotation deep links
 *
 * Cold-start URLs (`getCurrent()`) are intentionally NOT read here. Cold-
 * start handling is consumer-specific (a launching file goes through the
 * library init flow; an annotation jumps the reader), so each consumer
 * reads `getCurrent()` itself when it needs to.
 */
export function useAppUrlIngress() {
  const { appService } = useEnv();
  const listened = useRef(false);

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    if (listened.current) return;
    listened.current = true;

    const dispatch = (urls: string[], action?: 'VIEW' | 'SEND') => {
      if (!urls.length) return;
      console.log('App incoming URL:', urls, 'action:', action);
      eventDispatcher.dispatch('app-incoming-url', { urls, action });
    };

    const unlistenSingleInstance = getCurrentWindow().listen<SingleInstancePayload>(
      'single-instance',
      ({ payload }) => {
        const url = payload.args?.[1];
        if (url) dispatch([url]);
      },
    );

    const unlistenOpenFiles = getCurrentWindow().listen<OpenFilesPayload>(
      'open-files',
      ({ payload }) => {
        if (payload.files?.length) dispatch(payload.files);
      },
    );

    // FIXME: register/unregister of this plugin listener has caused freezes
    // on iOS in the past, so it's gated to Android. The Tauri v2 onOpenUrl
    // listener below covers iOS.
    let unlistenSharedIntent: Promise<PluginListener> | null = null;
    if (appService?.isAndroidApp) {
      unlistenSharedIntent = addPluginListener<SharedIntentPayload>(
        'native-bridge',
        'shared-intent',
        (payload) => {
          if (payload.urls?.length) dispatch(payload.urls, payload.action);
        },
      );
    }

    const unlistenOpenUrl = onOpenUrl((urls) => {
      if (urls?.length) dispatch(urls);
    });

    return () => {
      unlistenSingleInstance.then((f) => f());
      unlistenOpenFiles.then((f) => f());
      unlistenOpenUrl.then((f) => f());
      unlistenSharedIntent?.then((f) => f.unregister());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
