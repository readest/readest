import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { parseDeviceLinkDeepLink } from '@/utils/deeplink';
import { markLaunchUrl } from '@/utils/deeplinkConsume';
import { isMainAppWindow } from '@/utils/window';

// Module-scoped like useOpenShareLink: getCurrent() keeps returning the launch
// URL for the whole app session.
let coldStartConsumed = false;

/**
 * Open CrossPoint reader sign-in links on the app's /link page, so the account
 * the app is signed in to approves the code. A phone browser opening the link
 * is usually not signed in, and on iOS a social sign-in started there finishes
 * in the app (/auth/* is a Universal Link), so the browser could not finish.
 */
export function useOpenDeviceLink() {
  const router = useRouter();
  const { appService } = useEnv();

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string, coldStart = false) => {
      const link = parseDeviceLinkDeepLink(url);
      if (!link) return;
      // A cold-start read is acted on once per app run (see useOpenShareLink).
      const fresh = markLaunchUrl('launchDeviceLinkUrls', url);
      if (coldStart && !fresh) return;
      router.push(`/link?code=${encodeURIComponent(link.code)}`);
    };

    // Only the launch window reads the cold-start URL (#6104).
    if (!coldStartConsumed && isMainAppWindow()) {
      coldStartConsumed = true;
      getCurrent()
        .then((urls) => urls?.forEach((u) => handle(u, true)))
        .catch(() => {
          // Plugin not available on this platform: the live channel still works.
        });
    }

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach((u) => handle(u));
    };
    eventDispatcher.on('app-incoming-url', onIncoming);
    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService, router]);
}
