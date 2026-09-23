import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { windowNeedsClientOutline } from '@/utils/window';

/**
 * Draws the window's edge inside the client area on Windows 10, where the OS
 * gives an undecorated window no symmetric frame. Hidden while maximized or
 * fullscreen, where the edge is either off-screen or meant to be gone.
 */
const WindowOutline: React.FC = () => {
  const { appService } = useEnv();
  const needsOutline = !!appService && windowNeedsClientOutline(appService);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!needsOutline) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const update = async () => {
      const win = getCurrentWindow();
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      if (!disposed) setActive(!maximized && !fullscreen);
    };
    update();
    getCurrentWindow()
      .onResized(update)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [needsOutline]);

  if (!active) return null;

  return <div aria-hidden className='window-outline' />;
};

export default WindowOutline;
