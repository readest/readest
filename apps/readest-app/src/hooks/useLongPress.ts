import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLongPressOptions {
  onTap?: () => void;
  onLongPress?: () => void;
  onContextMenu?: () => void;
  onCancel?: () => void;
  threshold?: number;
  moveThreshold?: number;
}

interface UseLongPressResult {
  pressing: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
}

export const useLongPress = ({
  onTap,
  onLongPress,
  onContextMenu,
  onCancel,
  threshold = 500,
  moveThreshold = 10,
}: UseLongPressOptions): UseLongPressResult => {
  const [pressing, setPressing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);
  const isLongPressTriggered = useRef(false);

  const reset = useCallback(() => {
    setPressing(false);
    isLongPressTriggered.current = false;
    startPosRef.current = null;
    pointerId.current = null;
    clearTimeout(timerRef.current);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }

      pointerId.current = e.pointerId;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      isLongPressTriggered.current = false;
      setPressing(true);

      timerRef.current = setTimeout(() => {
        if (startPosRef.current) {
          isLongPressTriggered.current = true;
          onLongPress?.();
          setPressing(false);
        }
      }, threshold);
    },
    [onLongPress, threshold],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerId.current || !startPosRef.current) return;

      const deltaX = Math.abs(e.clientX - startPosRef.current.x);
      const deltaY = Math.abs(e.clientY - startPosRef.current.y);

      if (deltaX > moveThreshold || deltaY > moveThreshold) {
        onCancel?.();
        reset();
      }
    },
    [moveThreshold, onCancel, reset],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerId.current) return;

      if (!isLongPressTriggered.current && startPosRef.current) {
        const deltaX = Math.abs(e.clientX - startPosRef.current.x);
        const deltaY = Math.abs(e.clientY - startPosRef.current.y);

        if (deltaX <= moveThreshold && deltaY <= moveThreshold) {
          onTap?.();
        }
      }

      reset();
    },
    [onTap, moveThreshold, reset],
  );

  const handleCancel = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerId.current) return;
      onCancel?.();
      reset();
    },
    [onCancel, reset],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (onContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu();
      }
    },
    [onContextMenu],
  );

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  return {
    pressing,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerMove: handlePointerMove,
      onPointerCancel: handleCancel,
      onPointerLeave: handleCancel,
      onContextMenu: handleContextMenu,
    },
  };
};
