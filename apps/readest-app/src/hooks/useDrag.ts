import { useCallback, useRef } from 'react';

export const useDrag = (
  onDragMove: (data: { clientX: number; clientY: number; deltaX: number; deltaY: number }) => void,
  onDragEnd?: (data: {
    velocity: number;
    deltaT: number;
    clientX: number;
    clientY: number;
    deltaX: number;
    deltaY: number;
  }) => void,
) => {
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const lastX = useRef(0);
  const lastY = useRef(0);
  const startTime = useRef(0);

  const handleDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      isDragging.current = true;

      if ('touches' in e) {
        startY.current = e.touches[0]!.clientY;
        startX.current = e.touches[0]!.clientX;
      } else {
        startY.current = e.clientY;
        startX.current = e.clientX;
      }
      startTime.current = performance.now();

      const handleMove = (event: MouseEvent | TouchEvent) => {
        if (isDragging.current) {
          let deltaX = 0;
          let deltaY = 0;
          let clientX = 0;
          let clientY = 0;

          if ('touches' in event && event.touches.length > 0) {
            const currentTouch = event.touches[0]!;
            clientX = currentTouch.clientX;
            clientY = currentTouch.clientY;
          } else {
            const evt = event as MouseEvent;
            clientX = evt.clientX;
            clientY = evt.clientY;
          }
          deltaX = clientX - lastX.current;
          deltaY = clientY - lastY.current;
          lastX.current = clientX;
          lastY.current = clientY;

          onDragMove({ clientX, clientY, deltaX, deltaY });
        }
      };

      const handleEnd = (event: MouseEvent | TouchEvent) => {
        isDragging.current = false;
        let deltaX = 0;
        let deltaY = 0;
        let clientX = 0;
        let clientY = 0;
        const endTime = performance.now();
        const deltaT = endTime - startTime.current;

        if ('touches' in event) {
          const currentTouch = event.changedTouches[0]!;
          clientX = currentTouch.clientX;
          clientY = currentTouch.clientY;
        } else {
          const evt = event as MouseEvent;
          clientX = evt.clientX;
          clientY = evt.clientY;
        }
        deltaX = clientX - startX.current;
        deltaY = clientY - startY.current;
        const velocity = deltaY / deltaT;

        if (onDragEnd) {
          onDragEnd({ velocity, deltaT, clientX, clientY, deltaX, deltaY });
        }

        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);
      };

      window.addEventListener('mousemove', handleMove, { passive: true });
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleMove, { passive: true });
      window.addEventListener('touchend', handleEnd);
    },
    [onDragMove, onDragEnd],
  );

  return { handleDragStart };
};
