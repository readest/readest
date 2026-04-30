// used to execute a callback when the "active" state of the current window changes.
// On web and mobile, "active" means "is visible". On desktop, the 'visibilitychange'
// event is unreliable, so "active" means "has focus".

import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';

export type ActiveCallback = (isActive: boolean) => void;

type Cleanup = () => void;
async function activeChangedDesktop(onChange: ActiveCallback): Promise<Cleanup> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const appWindow = getCurrentWindow();

  const unlisten = await appWindow.onFocusChanged(({ payload: isActive }) => onChange(isActive));

  return () => {
    unlisten();
  };
}
async function activeChangedOther(onChange: ActiveCallback): Promise<Cleanup> {
  const handler = () => onChange(document.visibilityState === 'visible');

  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export function useWindowActiveChanged(callback: ActiveCallback) {
  const onActiveChanged = useRef<ActiveCallback>(callback);
  const { appService } = useEnv();

  const subscribe = appService?.isDesktopApp ? activeChangedDesktop : activeChangedOther;

  useEffect(() => {
    onActiveChanged.current = callback;
  }, [callback]);

  useEffect(() => {
    let isAlive = true;
    let unsub: Cleanup | undefined;
    const onChange = (isActive: boolean) => {
      onActiveChanged.current?.(isActive);
    };

    subscribe(onChange)
      .then((cleanup) => {
        if (isAlive) {
          unsub = cleanup;
        } else {
          // component was already unmounted, just clean up immediately
          cleanup();
        }
      })
      .catch((e) => {
        console.error('Could not listen for window active changes', e);
      });

    return () => {
      isAlive = false;
      unsub?.();
    };
  }, [subscribe]);
}
