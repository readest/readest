import { useEffect, useRef } from 'react';

export interface TouchDetail {
  phase: 'start' | 'move' | 'end';
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
