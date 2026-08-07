import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo, TauriEvent } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { type as osType } from '@tauri-apps/plugin-os';
import { eventDispatcher } from './event';

const APP_NAME = 'Readest';

/**
 * The OS window title, e.g. `Readest - The Hobbit`. It is never drawn in the
 * UI — desktop windows are either decorationless (Windows/Linux) or hide their
 * title text (the macOS overlay title bar) — but window switchers and screen
 * readers announce it, so it has to name the open book to tell windows apart.
 */
export const formatAppWindowTitle = (bookTitle?: string) => {
  const title = bookTitle?.trim();
  return title ? `${APP_NAME} - ${title}` : APP_NAME;
};

export const tauriSetWindowTitle = async (bookTitle?: string) => {
  await getCurrentWindow().setTitle(formatAppWindowTitle(bookTitle));
};

export const tauriGetWindowLogicalPosition = async () => {
  const currentWindow = getCurrentWindow();
  const factor = await currentWindow.scaleFactor();
  const physicalPos = await currentWindow.outerPosition();
  return { x: physicalPos.x / factor, y: physicalPos.y / factor };
};

export const tauriHandleMinimize = async () => {
  getCurrentWindow().minimize();
};

// workaround to reset transparent background when toggling fullscreen/maximize
const linuxWindowRestoreTransparentBg = async () => {
  const currentSize = await getCurrentWindow().innerSize();
  currentSize.width -= 1;
  currentSize.height -= 1;
  await getCurrentWindow().setSize(currentSize);
  setTimeout(async () => {
    const currentSize = await getCurrentWindow().innerSize();
    currentSize.width += 1;
    currentSize.height += 1;
    await getCurrentWindow().setSize(currentSize);
  }, 100);
};

export const tauriHandleToggleMaximize = async () => {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  if (isFullscreen) {
    await currentWindow.setFullscreen(false);
    await currentWindow.unmaximize();
  } else {
    await currentWindow.toggleMaximize();
  }
  if ((await osType()) === 'linux') {
    linuxWindowRestoreTransparentBg();
  }
};

export const tauriHandleClose = async () => {
  getCurrentWindow().close();
};

export const tauriHandleOnCloseWindow = async (callback: () => void) => {
  const currentWindow = getCurrentWindow();
  return await currentWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    // On macOS, the main window's close is intercepted by the Rust backend
    // to hide the window (close-to-hide), keeping the app in the dock. Skip
    // the in-app cleanup — the user is just minimizing the window and
    // expects the active book to still be there when the window reopens.
    if (currentWindow.label === 'main' && (await osType()) === 'macos') {
      return;
    }
    await callback();
    if (currentWindow.label.startsWith('reader')) {
      await emitTo('main', 'close-reader-window', { label: currentWindow.label });
      setTimeout(() => currentWindow.destroy(), 300);
    } else if (currentWindow.label === 'main') {
      await currentWindow.destroy();
    }
  });
};

// Whether the window was maximized when it last entered fullscreen, so the
// maximized state survives a fullscreen round-trip on Windows.
let wasMaximizedBeforeFullscreen = false;

export const tauriHandleToggleFullScreen = async () => {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  // Toggle fullscreen regardless of the maximized state. Previously a maximized
  // window was only unmaximized here, so the fullscreen button did nothing when
  // the window was maximized, which is always the case on mobile shells like
  // Phosh and common on Windows (issue #4034).
  if (isFullscreen) {
    await currentWindow.setFullscreen(false);
    if (wasMaximizedBeforeFullscreen) {
      wasMaximizedBeforeFullscreen = false;
      await currentWindow.maximize();
    }
  } else {
    // On Windows, tao keeps the WS_MAXIMIZE style when a maximized window
    // enters borderless fullscreen, so Windows clamps the window to the work
    // area and the taskbar stays visible but unclickable (issue #5295).
    // Unmaximize first and restore the maximized state on exit. Other
    // platforms must keep entering fullscreen straight from the maximized
    // state (Phosh windows are always maximized).
    wasMaximizedBeforeFullscreen =
      (await osType()) === 'windows' && (await currentWindow.isMaximized());
    if (wasMaximizedBeforeFullscreen) {
      await currentWindow.unmaximize();
    }
    await currentWindow.setFullscreen(true);
  }
  if ((await osType()) === 'linux') {
    linuxWindowRestoreTransparentBg();
  }
};

export const tauriHandleSetAlwaysOnTop = async (isAlwaysOnTop: boolean) => {
  const windows = await getAllWindows();
  await Promise.all(windows.map((w) => w.setAlwaysOnTop(isAlwaysOnTop)));
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
