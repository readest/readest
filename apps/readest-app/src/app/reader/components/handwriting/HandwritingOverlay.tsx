import React from 'react';

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
    rect,
    containerRef,
    attach,
    detach,
    enabled,
    setEnabled,
    erasing,
    setErasing,
    undo,
    redo,
    clear,
  } = useHandwriting(_bookKey);

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
      <div className='bg-base-100/90 eink-bordered absolute bottom-4 right-4 z-10 rounded-md p-1'>
        <HandwritingToolbar
          enabled={enabled}
          onToggle={() => setEnabled(!enabled)}
          erasing={erasing}
          onToggleErase={() => setErasing(!erasing)}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
        />
      </div>
    </>
  );
};

export default HandwritingOverlay;
