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
