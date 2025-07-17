import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo, TauriEvent } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { eventDispatcher } from './event';

export const tauriGetWindowLogicalPosition = async () => {
  const currentWindow = getCurrentWindow();
  const factor = await currentWindow.scaleFactor();
  const physicalPos = await currentWindow.outerPosition();
  return { x: physicalPos.x / factor, y: physicalPos.y / factor };
};

export const tauriHandleMinimize = async () => {
  getCurrentWindow().minimize();
};

export const tauriHandleToggleMaximize = async () => {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  if (isFullscreen) {
    await currentWindow.setFullscreen(false);
    await currentWindow.unmaximize();
  } else {
    getCurrentWindow().toggleMaximize();
  }
};

export const tauriHandleClose = async () => {
  getCurrentWindow().close();
};

export const tauriHandleOnCloseWindow = async (callback: () => void) => {
  const currentWindow = getCurrentWindow();
  return currentWindow.listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async () => {
    await callback();
    if (currentWindow.label.startsWith('reader')) {
      await emitTo('main', 'close-reader-window', { label: currentWindow.label });
      setTimeout(() => currentWindow.destroy(), 300);
    } else if (currentWindow.label === 'main') {
      await currentWindow.destroy();
    }
  });
};

export const tauriHandleToggleFullScreen = async () => {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  const isMaximized = await currentWindow.isMaximized();
  if (isMaximized) {
    await currentWindow.unmaximize();
  } else {
    await currentWindow.setFullscreen(!isFullscreen);
  }
};

export const tauriHandleSetAlwaysOnTop = async (isAlwaysOnTop: boolean) => {
  const currentWindow = getCurrentWindow();
  await currentWindow.setAlwaysOnTop(isAlwaysOnTop);
};

export const tauriGetAlwaysOnTop = async () => {
  const currentWindow = getCurrentWindow();
  return await currentWindow.isAlwaysOnTop();
};

export const tauriHandleOnWindowFocus = async (callback: () => void) => {
  const currentWindow = getCurrentWindow();
  return currentWindow.listen(TauriEvent.WINDOW_FOCUS, async () => {
    await callback();
  });
};

export const tauriQuitApp = async () => {
  await eventDispatcher.dispatch('quit-app');
  await exit(0);
};
