import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { needsPointerWindowControls } from '@/services/environment';
import { startPointerWindowResize, type ResizeEdge } from '@/utils/windowPointerDrag';

const THICKNESS = 6;
const CORNER = 14;

const HANDLES: Array<{ edge: ResizeEdge; cursor: string; style: React.CSSProperties }> = [
  {
    edge: 'n',
    cursor: 'ns-resize',
    style: { top: 0, left: CORNER, right: CORNER, height: THICKNESS },
  },
  {
    edge: 's',
    cursor: 'ns-resize',
    style: { bottom: 0, left: CORNER, right: CORNER, height: THICKNESS },
  },
  {
    edge: 'w',
    cursor: 'ew-resize',
    style: { left: 0, top: CORNER, bottom: CORNER, width: THICKNESS },
  },
  {
    edge: 'e',
    cursor: 'ew-resize',
    style: { right: 0, top: CORNER, bottom: CORNER, width: THICKNESS },
  },
  { edge: 'nw', cursor: 'nwse-resize', style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  {
    edge: 'se',
    cursor: 'nwse-resize',
    style: { bottom: 0, right: 0, width: CORNER, height: CORNER },
  },
  { edge: 'ne', cursor: 'nesw-resize', style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  {
    edge: 'sw',
    cursor: 'nesw-resize',
    style: { bottom: 0, left: 0, width: CORNER, height: CORNER },
  },
];

/**
 * Invisible resize borders for undecorated windows whose runtime offers none
 * (the Linux CEF build, see `needsPointerWindowControls`). Hidden while the
 * window is maximized or fullscreen, where the edges must not react.
 */
const WindowResizeHandles: React.FC = () => {
  const { appService } = useEnv();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!appService?.hasWindowBar || !needsPointerWindowControls()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const update = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      if (!disposed) setActive(!maximized && !fullscreen);
    };
    update();
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onResized(update)
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        }),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appService?.hasWindowBar]);

  if (!active) return null;

  return (
    <>
      {HANDLES.map(({ edge, cursor, style }) => (
        <div
          key={edge}
          aria-hidden
          style={{ position: 'fixed', zIndex: 2147483000, cursor, ...style }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startPointerWindowResize(e.nativeEvent, edge);
          }}
        />
      ))}
    </>
  );
};

export default WindowResizeHandles;
