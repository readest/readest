import React, { useEffect, useRef } from 'react';

import { renderStrokes } from '@/services/handwriting/renderer';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkLayer } from '../../hooks/useHandwriting';

interface HandwritingCanvasProps {
  /** Ink to draw, each layer normalized to its own rect in viewport coordinates. */
  layers: InkLayer[];
  /** The overlay's own bounds; the canvas covers it. */
  cellRect: PageRect;
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
  layers,
  cellRect,
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
    canvas.width = Math.max(1, Math.round(cellRect.width * dpr));
    canvas.height = Math.max(1, Math.round(cellRect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cellRect.width, cellRect.height);
    for (const { strokes, rect } of layers) {
      renderStrokes(
        ctx,
        strokes,
        {
          left: rect.left - cellRect.left,
          top: rect.top - cellRect.top,
          width: rect.width,
          height: rect.height,
        },
        false,
      );
    }
  }, [layers, cellRect, dpr]);

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
        style={{
          width: cellRect.width,
          height: cellRect.height,
          touchAction: 'none',
          // Nothing to select here; keeps iOS selection gestures off the Pencil.
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      />
    </div>
  );
};

export default HandwritingCanvas;
