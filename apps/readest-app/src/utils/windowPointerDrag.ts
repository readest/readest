/**
 * Pointer-driven window move and resize for runtimes whose native drag does not
 * work: the Linux CEF build (see `needsPointerWindowControls`). The window is
 * moved/resized through the window plugin on every pointer move, coalesced to
 * one call per animation frame. Coordinates are physical pixels; pointer
 * positions come in CSS pixels (`screenX`/`screenY`) and are scaled.
 */
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_SIZE = { width: 400, height: 300 };

/** New window frame for dragging `edge` by `delta`; moving edges stay under the pointer down to `min`. */
export const computeResizedFrame = (
  edge: ResizeEdge,
  start: Frame,
  delta: { dx: number; dy: number },
  min: { width: number; height: number },
): Frame => {
  let { x, y, width, height } = start;
  if (edge.includes('e')) {
    width = Math.max(min.width, start.width + delta.dx);
  }
  if (edge.includes('s')) {
    height = Math.max(min.height, start.height + delta.dy);
  }
  if (edge.includes('w')) {
    width = Math.max(min.width, start.width - delta.dx);
    x = start.x + start.width - width;
  }
  if (edge.includes('n')) {
    height = Math.max(min.height, start.height - delta.dy);
    y = start.y + start.height - height;
  }
  return { x, y, width, height };
};

const trackPointer = (
  startEvent: MouseEvent,
  onDelta: (delta: { dx: number; dy: number }) => void,
) => {
  const origin = { x: startEvent.screenX, y: startEvent.screenY };
  let frame: number | null = null;
  let latest = { dx: 0, dy: 0 };
  const onMove = (e: MouseEvent) => {
    latest = { dx: e.screenX - origin.x, dy: e.screenY - origin.y };
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        frame = null;
        onDelta(latest);
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    if (frame !== null) {
      // A quick drag can end before its only frame runs; apply it anyway.
      cancelAnimationFrame(frame);
      frame = null;
      onDelta(latest);
    }
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
};

/**
 * Reports whether the button went up while the window state was being read;
 * tracking must not start after that, or the next unrelated pointer move would
 * drag the window from the stale origin.
 */
const watchRelease = () => {
  let released = false;
  const onUp = () => {
    released = true;
  };
  window.addEventListener('mouseup', onUp, true);
  return () => {
    window.removeEventListener('mouseup', onUp, true);
    return released;
  };
};

export const startPointerWindowMove = async (startEvent: MouseEvent) => {
  const released = watchRelease();
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    released();
    return;
  }
  const [start, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
  if (released()) return;
  trackPointer(startEvent, ({ dx, dy }) => {
    win.setPosition(
      new PhysicalPosition(Math.round(start.x + dx * scale), Math.round(start.y + dy * scale)),
    );
  });
};

export const startPointerWindowResize = async (startEvent: MouseEvent, edge: ResizeEdge) => {
  const released = watchRelease();
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    released();
    return;
  }
  const [position, size, scale] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
  ]);
  if (released()) return;
  const start: Frame = { x: position.x, y: position.y, width: size.width, height: size.height };
  const min = { width: MIN_WINDOW_SIZE.width * scale, height: MIN_WINDOW_SIZE.height * scale };
  trackPointer(startEvent, ({ dx, dy }) => {
    const next = computeResizedFrame(edge, start, { dx: dx * scale, dy: dy * scale }, min);
    if (next.x !== start.x || next.y !== start.y) {
      win.setPosition(new PhysicalPosition(Math.round(next.x), Math.round(next.y)));
    }
    win.setSize(new PhysicalSize(Math.round(next.width), Math.round(next.height)));
  });
};
