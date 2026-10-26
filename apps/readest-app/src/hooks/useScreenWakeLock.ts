import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { setScreenWakeLock } from '@/utils/bridge';

// Serialize native updates across effect cleanup/remounts: a late release must
// finish before a new reader acquires the app-wide iOS idle timer.
let nativeWakeLockUpdate = Promise.resolve();

export const useScreenWakeLock = (lock: boolean, hasWindow?: boolean, isIOSApp = false) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (isTauriAppPlatform() && isIOSApp) {
      if (!lock) return;
      const updateNativeWakeLock = (enabled: boolean) => {
        nativeWakeLockUpdate = nativeWakeLockUpdate
          .then(() => setScreenWakeLock(enabled))
          .catch((err) => console.info('Failed to update native wake lock:', err));
      };
      const handleVisibilityChange = () => updateNativeWakeLock(!document.hidden);
      handleVisibilityChange();
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        updateNativeWakeLock(false);
      };
    }

    let cancelled = false;
    let shouldHoldWakeLock = lock;
    let requestPending = false;
    let unlistenOnFocusChanged: Promise<() => void> | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;

    const requestWakeLock = async () => {
      shouldHoldWakeLock = true;
      if (requestPending || wakeLockRef.current) return;
      requestPending = true;
      try {
        if ('wakeLock' in navigator) {
          const sentinel = await navigator.wakeLock.request('screen');
          if (cancelled || !shouldHoldWakeLock) {
            await sentinel.release();
            return;
          }
          wakeLockRef.current = sentinel;

          sentinel.addEventListener('release', () => {
            if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
          });

          console.log('Wake lock acquired');
        }
      } catch (err) {
        console.info('Failed to acquire wake lock:', err);
      } finally {
        requestPending = false;
      }
    };

    const releaseWakeLock = () => {
      shouldHoldWakeLock = false;
      const sentinel = wakeLockRef.current;
      if (sentinel) {
        wakeLockRef.current = null;
        void sentinel.release().catch((err) => console.info('Failed to release wake lock:', err));
        console.log('Wake lock released');
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseWakeLock();
      } else {
        requestWakeLock();
      }
    };

    const handlePageFocus = () => {
      clearTimeout(blurTimer);
      requestWakeLock();
    };

    if (lock) {
      requestWakeLock();
    } else if (wakeLockRef.current) {
      releaseWakeLock();
    }

    const useDocumentVisibility = isWebAppPlatform() || hasWindow === false;
    if (useDocumentVisibility && lock) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else if (isTauriAppPlatform() && hasWindow && lock) {
      // On Linux CEF, refocusing the window reports focus and then blur as the
      // browser view takes keyboard focus from the toplevel, and the page gets
      // focus a few ms later (#7085). Trust a blur only if the page is still
      // unfocused shortly after it.
      unlistenOnFocusChanged = getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          clearTimeout(blurTimer);
          if (focused) {
            requestWakeLock();
          } else {
            blurTimer = setTimeout(() => {
              if (!document.hasFocus()) releaseWakeLock();
            }, 100);
          }
        })
        .catch((error) => {
          console.info('Failed to register window focus listener:', error);
          return () => {};
        });
      // The page may get focus only after that check released the lock.
      window.addEventListener('focus', handlePageFocus);
    }

    return () => {
      cancelled = true;
      releaseWakeLock();
      if (useDocumentVisibility && lock) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      clearTimeout(blurTimer);
      window.removeEventListener('focus', handlePageFocus);
      void unlistenOnFocusChanged?.then((unlisten) => unlisten());
    };
  }, [lock, hasWindow, isIOSApp]);
};
