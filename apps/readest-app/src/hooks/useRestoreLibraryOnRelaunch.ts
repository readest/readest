import { useEffect } from 'react';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { ensureMainLibraryWindow } from '@/utils/nav';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

/**
 * Brings the library back when the app is relaunched (e.g. from the desktop
 * shortcut) after the user closed it and left only reader windows open
 * (#6394). The single-instance callback focuses the `main` window, which does
 * nothing once it is gone, so the first reader window recreates it. Launches
 * carrying a file or link are left to `useOpenWithBooks` / `useOpenLaunchLinks`.
 */
export function useRestoreLibraryOnRelaunch() {
  const { appService } = useEnv();

  useEffect(() => {
    if (!appService?.hasWindow) return;
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.listen<SingleInstancePayload>(
      'single-instance',
      async ({ payload }) => {
        if (payload.args?.[1]) return;
        const labels = (await getAllWindows()).map((w) => w.label).sort();
        if (labels.includes('main') || labels[0] !== currentWindow.label) return;
        await ensureMainLibraryWindow(appService);
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, [appService]);
}
