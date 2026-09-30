import React, { useEffect } from 'react';

import { eventDispatcher } from '@/utils/event';
import { useHandwriting } from '../../hooks/useHandwriting';
import HandwritingCanvas from './HandwritingCanvas';
import HandwritingToolbar from './HandwritingToolbar';

interface HandwritingOverlayProps {
  bookKey: string;
}

/**
 * Drop-in overlay for one open book: owns the toggle, the canvas, and the
 * toolbar. Degrades gracefully everywhere handwriting input isn't available
 * — HandwritingService/detectPenCapabilities resolve to the 'none' backend
 * and the canvas simply never receives strokes to draw.
 */
const HandwritingOverlay: React.FC<HandwritingOverlayProps> = ({ bookKey: _bookKey }) => {
  const {
    strokes,
    hasInk,
    rect,
    containerRef,
    attach,
    detach,
    enabled,
    setEnabled,
    reload,
    erasing,
    setErasing,
    undo,
    redo,
    clear,
    penColor,
    penWidth,
    selectPenColor,
    selectPenWidth,
    restylePage,
  } = useHandwriting(_bookKey);

  useEffect(() => {
    const onHandwritingEvent = (event: CustomEvent) => {
      const { action } = event.detail as { action?: string };
      if (action === 'enable') setEnabled(true);
      if (action === 'reload') reload();
    };
    eventDispatcher.on('handwriting', onHandwritingEvent);
    return () => {
      eventDispatcher.off('handwriting', onHandwritingEvent);
    };
  }, [setEnabled, reload]);

  return (
    <>
      <HandwritingCanvas
        strokes={strokes}
        rect={rect}
        interactive={enabled}
        overlayRef={containerRef}
        attach={attach}
        detach={detach}
      />
      <div className='bg-base-100/90 eink-bordered absolute right-4 top-4 z-10 rounded-md p-1'>
        <HandwritingToolbar
          enabled={enabled}
          onToggle={() => setEnabled(!enabled)}
          erasing={erasing}
          onToggleErase={() => setErasing(!erasing)}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          penColor={penColor}
          penWidth={penWidth}
          onSelectColor={selectPenColor}
          onSelectWidth={selectPenWidth}
          onRestyle={restylePage}
          hasInk={hasInk}
        />
      </div>
    </>
  );
};

export default HandwritingOverlay;
