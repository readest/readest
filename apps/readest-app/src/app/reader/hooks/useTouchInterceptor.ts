import { useEffect, useRef } from 'react';

// A horizontal page-turn gesture becomes intentional at this distance. Keep
// the generic toolbar handling and captured turn interceptor on the same
// boundary so neither can act in the gap before the other claims the swipe.
export const TOUCH_SWIPE_THRESHOLD_PX = 15;

// Movement below this distance is still a tap. Touchend must leave these
// gestures alone because the browser's synthesized click is the single owner
// of center-tap toolbar toggling.
export const TOUCH_TAP_SLOP_PX = TOUCH_SWIPE_THRESHOLD_PX;

// The paginator announces layered turns only after it has actually claimed a
// horizontal gesture. Generic toolbar handling yields to that active gesture,
// not merely to a configured turn style (which may be inactive in scroll,
// E-ink, no-animation, selection, or boundary cases).
const activeLayeredTurnGestures = new Set<string>();

export const setLayeredTurnGestureActive = (bookKey: string, active: boolean) => {
  if (active) activeLayeredTurnGestures.add(bookKey);
  else activeLayeredTurnGestures.delete(bookKey);
};

export const isLayeredTurnGestureActive = (bookKey: string) =>
  activeLayeredTurnGestures.has(bookKey);

export interface TouchDetail {
  phase: 'start' | 'move' | 'end' | 'cancel';
  touch: { screenX: number; screenY: number };
  touchStart: { screenX: number; screenY: number };
  deltaX: number;
  deltaY: number;
  deltaT: number;
}

export type TouchInterceptorFn = (bookKey: string, detail: TouchDetail) => boolean;

interface TouchInterceptorEntry {
  handler: TouchInterceptorFn;
  priority: number;
}

// Module-level registry — interceptors are called in descending priority order.
// The first interceptor that returns true consumes the gesture.
const interceptors = new Map<string, TouchInterceptorEntry>();

export const registerTouchInterceptor = (
  id: string,
  handler: TouchInterceptorFn,
  priority = 0,
): (() => void) => {
  interceptors.set(id, { handler, priority });
  return () => {
    interceptors.delete(id);
  };
};

export const dispatchTouchInterceptors = (bookKey: string, detail: TouchDetail): boolean => {
  const sorted = [...interceptors.values()].sort((a, b) => b.priority - a.priority);
  for (const { handler } of sorted) {
    if (handler(bookKey, detail)) return true;
  }
  return false;
};

/**
 * React hook for registering a touch interceptor with automatic cleanup.
 * The handler ref is updated on every render so the interceptor always
 * calls the latest closure without re-registering.
 */
export const useTouchInterceptor = (id: string, handler: TouchInterceptorFn, priority = 0) => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return registerTouchInterceptor(
      id,
      (bookKey, detail) => handlerRef.current(bookKey, detail),
      priority,
    );
  }, [id, priority]);
};
