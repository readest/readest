import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';

export const useScreenWakeLock = (lock: boolean) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const unlistenOnFocusChangedRef = useRef<Promise<() => void> | null>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');

          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });

          console.log('Wake lock acquired');
        }
      } catch (err) {
        console.info('Failed to acquire wake lock:', err);
      }
    };

    const releaseWakeLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
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

    if (isWebAppPlatform() && lock) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else if (isTauriAppPlatform() && lock) {
      unlistenOnFocusChangedRef.current = getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          if (focused) {
            requestWakeLock();
          } else {
            releaseWakeLock();
          }
        },
      );
    }

    return () => {
      releaseWakeLock();
      if (isWebAppPlatform() && lock) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (unlistenOnFocusChangedRef.current) {
        unlistenOnFocusChangedRef.current.then((f) => f());
      }
    };
  }, [lock]);
};
