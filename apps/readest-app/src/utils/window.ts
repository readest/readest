import { eventDispatcher } from './event';

export const tauriGetWindowLogicalPosition = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const currentWindow = getCurrentWindow();
  const factor = await currentWindow.scaleFactor();
  const physicalPos = await currentWindow.outerPosition();
  return { x: physicalPos.x / factor, y: physicalPos.y / factor };
};

export const tauriHandleMinimize = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().minimize();
};

export const tauriHandleToggleMaximize = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().toggleMaximize();
};

export const tauriHandleClose = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().close();
};

export const tauriHandleOnCloseWindow = async (callback: () => void) => {
  const { TauriEvent } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { exit } = await import('@tauri-apps/plugin-process');
  const currentWindow = getCurrentWindow();
  return currentWindow.listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async () => {
    await callback();
    console.log('exit app');
    await exit(0);
  });
};

export const tauriHandleOnWindowFocus = async (callback: () => void) => {
  const { TauriEvent } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const currentWindow = getCurrentWindow();
  return currentWindow.listen(TauriEvent.WINDOW_FOCUS, async () => {
    await callback();
  });
};

export const tauriQuitApp = async () => {
  await eventDispatcher.dispatch('quit-app');
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
};
