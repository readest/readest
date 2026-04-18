// used to execute a callback when the "active" state of the current window changes.
// On web abd mobile, "active" means "is visible". On desktop, the 'visibilitychange'
// event is unrelaible, so "active" means "has focus".

import { useEffect, useRef } from 'react';
import environment from '@/services/environment';

export type ActiveCallback = (isActive: boolean) => void;

type Cleanup = () => void;
async function activeChangedDesktop(onChange: ActiveCallback): Promise<Cleanup> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const appWindow = getCurrentWindow();

  const unFocus = await appWindow.listen('tauri://focus', () => onChange(true));
  const unBlur = await appWindow.listen('tauri://blur', () => onChange(false));
  return () => {
    unFocus();
    unBlur();
  };
}
async function activeChangedOther(onChange: ActiveCallback): Promise<Cleanup> {
  const handler = () => onChange(document.visibilityState === 'visible');

  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export function useWindowActiveChanged(callback: ActiveCallback) {
  const onActiveChanged = useRef<ActiveCallback>(callback);
  useEffect(() => {
    onActiveChanged.current = callback;
  }, [callback]);

  useEffect(() => {
    let isAlive = true;
    let unsub: Cleanup | undefined;
    const onChange = (isActive: boolean) => {
      onActiveChanged.current?.(isActive);
    };

    environment
      .getAppService()
      .then(({ isDesktopApp }) => {
        return isDesktopApp ? activeChangedDesktop : activeChangedOther;
      })
      .then((sub) => sub(onChange))
      .then((cleanup) => {
        if (isAlive) {
          unsub = cleanup;
        } else {
          // component was already unmounted, just clean up immediately
          cleanup();
        }
      });

    return () => {
      isAlive = false;
      unsub?.();
    };
  }, []);
}
