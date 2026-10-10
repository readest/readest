import React, { useEffect, useRef } from 'react';

import { renderStrokes } from '@/services/handwriting/renderer';
import type { InkStroke } from '@/services/handwriting/model';
import type { PageRect } from '@/services/handwriting/coords';

interface HandwritingCanvasProps {
  strokes: InkStroke[];
  rect: PageRect;
  interactive: boolean;
  overlayRef: (el: HTMLDivElement | null) => void;
  attach: (el: HTMLElement | null) => void;
  detach: () => void;
}

/**
 * Renders committed + in-progress ink on a canvas positioned over the
 * reader viewport. Purely a rendering + input-capture surface: all state
 * lives in useHandwriting/HandwritingService, so this re-renders on prop
 * changes only, never on its own timers.
 */
const HandwritingCanvas: React.FC<HandwritingCanvasProps> = ({
  strokes,
  rect,
  interactive,
  overlayRef,
  attach,
  detach,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderStrokes(ctx, strokes, { left: 0, top: 0, width: rect.width, height: rect.height });
  }, [strokes, rect, dpr]);

  useEffect(() => {
    if (!interactive) return;
    const el = canvasRef.current;
    void attach(el);
    return () => {
      void detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  return (
    <div
      ref={overlayRef}
      className='pointer-events-none absolute inset-0'
      style={{ touchAction: interactive ? 'none' : undefined }}
    >
      <canvas
        ref={canvasRef}
        className={interactive ? 'pointer-events-auto absolute inset-0' : 'absolute inset-0'}
        style={{ width: rect.width, height: rect.height, touchAction: 'none' }}
      />
    </div>
  );
};

export default HandwritingCanvas;
