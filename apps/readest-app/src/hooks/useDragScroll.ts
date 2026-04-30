import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

interface UseDragScrollOptions {
  /** When false, pointer events are ignored. */
  enabled?: boolean;
  /** Pixels the pointer must travel before entering drag mode. */
  threshold?: number;
  /**
   * Milliseconds to suppress the synthetic click that browsers fire after a drag.
   * Without this, releasing the mouse on a child button would register as a tap.
   */
  clickSuppressMs?: number;
}

interface UseDragScrollResult<T extends HTMLElement> {
  /** True while the pointer has moved past the threshold. Useful for cursor styling. */
  isDragging: boolean;
  /** Spread these on the scroll container. */
  pointerHandlers: {
    onPointerDown: (event: React.PointerEvent<T>) => void;
    onPointerMove: (event: React.PointerEvent<T>) => void;
    onPointerUp: (event: React.PointerEvent<T>) => void;
    onPointerCancel: (event: React.PointerEvent<T>) => void;
    onPointerLeave: (event: React.PointerEvent<T>) => void;
  };
  /**
   * Returns true if a pending drag or recent drag-release should swallow a
   * click. Child click handlers should early-return when this is true.
   */
  shouldSuppressClick: () => boolean;
}

/**
 * Adds mouse drag-to-scroll to a horizontally scrollable container. Touch users
 * already get native momentum scrolling, so this hook intentionally ignores
 * non-mouse pointer types.
 */
export function useDragScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { enabled = true, threshold = 6, clickSuppressMs = 120 }: UseDragScrollOptions = {},
): UseDragScrollResult<T> {
  const [isDragging, setIsDragging] = useState(false);
  const stateRef = useRef({
    active: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuppressTimer = useCallback(() => {
    if (suppressTimerRef.current) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<T>) => {
      if (!enabled || event.pointerType !== 'mouse') return;
      const el = ref.current;
      if (!el) return;
      stateRef.current = {
        active: true,
        startX: event.clientX,
        startScrollLeft: el.scrollLeft,
        moved: false,
      };
      setIsDragging(false);
    },
    [enabled, ref],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<T>) => {
      const state = stateRef.current;
      const el = ref.current;
      if (!el || !state.active) return;
      const deltaX = event.clientX - state.startX;
      if (!state.moved && Math.abs(deltaX) >= threshold) {
        state.moved = true;
        setIsDragging(true);
      }
      if (state.moved) {
        el.scrollLeft = state.startScrollLeft - deltaX;
        event.preventDefault();
      }
    },
    [ref, threshold],
  );

  const endDrag = useCallback(() => {
    const state = stateRef.current;
    if (!state.active) return;
    const moved = state.moved;
    state.active = false;
    state.moved = false;
    setIsDragging(false);
    if (moved) {
      clearSuppressTimer();
      suppressClickRef.current = true;
      suppressTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false;
        suppressTimerRef.current = null;
      }, clickSuppressMs);
    }
  }, [clearSuppressTimer, clickSuppressMs]);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<T>) => {
      if (event.pointerType !== 'mouse') return;
      endDrag();
    },
    [endDrag],
  );

  const onPointerCancel = useCallback(() => endDrag(), [endDrag]);
  const onPointerLeave = useCallback(
    (event: React.PointerEvent<T>) => {
      if (event.pointerType !== 'mouse') return;
      endDrag();
    },
    [endDrag],
  );

  useEffect(() => {
    return () => {
      clearSuppressTimer();
      suppressClickRef.current = false;
      stateRef.current.active = false;
      stateRef.current.moved = false;
    };
  }, [clearSuppressTimer]);

  const shouldSuppressClick = useCallback(
    () => stateRef.current.active || suppressClickRef.current,
    [],
  );

  return {
    isDragging,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
    },
    shouldSuppressClick,
  };
}
