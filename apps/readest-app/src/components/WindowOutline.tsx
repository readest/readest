import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { windowNeedsClientOutline } from '@/utils/window';

/** How long the window must stop changing before its outline is measured again. */
export const RESIZE_SETTLE_MS = 200;

/**
 * Draws the window's edge inside the client area on Windows 10, where the OS
 * gives an undecorated window no symmetric frame. Hidden while maximized or
 * fullscreen, where the edge is either off-screen or meant to be gone.
 *
 * The box is sized from the window, not from the page. A page viewport is a whole
 * number of CSS pixels while a window is a whole number of device pixels, so a
 * fractional scale factor rounds the viewport up past the window — at 150%, a
 * 1544-device-pixel-wide window lays out 1030 CSS pixels, which is 1545 device
 * pixels, one more than the window has. An `inset: 0` border then lands on device
 * pixels the window does not have and is never painted, while the top and left
 * edges, anchored at 0, survive. Each dimension rounds on its own, which is why
 * some edges vanish rather than all four, and only at the sizes that round up.
 *
 * Only a window that has stopped moving is measured. Mid-drag the page lags the OS
 * window by an amount nothing inside the page can know, and a line drawn then lands
 * either outside a shrinking window or short of a growing one.
 */
const WindowOutline: React.FC = () => {
  const { appService } = useEnv();
  const needsOutline = !!appService && windowNeedsClientOutline(appService);
  const [active, setActive] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!needsOutline) return;
    let disposed = false;
    // Bumped by every movement, so a measurement that is still awaiting the window
    // when the next one arrives is discarded rather than applied to a moving window.
    let moved = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    // These reads go to the window backend and can reject. Nothing awaits them, so an
    // escaping rejection would be silent; leaving the outline down is the safe outcome.
    const measure = async (token: number) => {
      try {
        const win = getCurrentWindow();
        const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
        if (disposed || token !== moved || maximized || fullscreen) return;
        const { width, height } = await win.innerSize();
        if (disposed || token !== moved) return;
        const dpr = window.devicePixelRatio || 1;
        setBox({ width: width / dpr, height: height / dpr });
        setActive(true);
      } catch {
        // A read overtaken by a newer one must not take down the frame that one drew.
        if (!disposed && token === moved) setActive(false);
      }
    };

    const resizing = () => {
      moved += 1;
      setActive(false);
      clearTimeout(timer);
      timer = setTimeout(() => void measure(moved), RESIZE_SETTLE_MS);
    };
    resizing();

    // If registration rejects, the page's own resize listener still drives the timer.
    getCurrentWindow()
      .onResized(resizing)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    window.addEventListener('resize', resizing);

    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('resize', resizing);
      unlisten?.();
    };
  }, [needsOutline]);

  if (!active) return null;

  return <div aria-hidden className='window-outline' style={box} />;
};

export default WindowOutline;
