import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';

export const useScreenWakeLock = (lock: boolean, hasWindow?: boolean) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;
    let shouldHoldWakeLock = lock;
    let requestPending = false;
    let unlistenOnFocusChanged: Promise<() => void> | null = null;

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

    if (lock) {
      requestWakeLock();
    } else if (wakeLockRef.current) {
      releaseWakeLock();
    }

    const useDocumentVisibility = isWebAppPlatform() || hasWindow === false;
    if (useDocumentVisibility && lock) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else if (isTauriAppPlatform() && hasWindow && lock) {
      unlistenOnFocusChanged = getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (focused) {
            requestWakeLock();
          } else {
            releaseWakeLock();
          }
        })
        .catch((error) => {
          console.info('Failed to register window focus listener:', error);
          return () => {};
        });
    }

    return () => {
      cancelled = true;
      releaseWakeLock();
      if (useDocumentVisibility && lock) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      void unlistenOnFocusChanged?.then((unlisten) => unlisten());
    };
  }, [lock, hasWindow]);
};
