import React, { useEffect } from 'react';

import { Insets } from '@/types/misc';
import { eventDispatcher } from '@/utils/event';
import { useHandwriting } from '../../hooks/useHandwriting';
import HandwritingCanvas from './HandwritingCanvas';
import HandwritingToolbar from './HandwritingToolbar';

interface HandwritingOverlayProps {
  bookKey: string;
  gridInsets: Insets;
}

/**
 * Ink layer for one open book. Always paints the current page's ink; takes
 * pen input and shows its toolbar only while handwriting mode is on (toggled
 * from the View menu).
 */
const HandwritingOverlay: React.FC<HandwritingOverlayProps> = ({ bookKey, gridInsets }) => {
  const hw = useHandwriting(bookKey);
  const { setEnabled, reload } = hw;

  useEffect(() => {
    const onHandwritingEvent = (event: CustomEvent) => {
      const { action, bookKey: target } = event.detail as { action: string; bookKey: string };
      if (target !== bookKey) return;
      if (action === 'toggle') setEnabled((enabled) => !enabled);
      if (action === 'reload') reload();
    };
    eventDispatcher.on('handwriting', onHandwritingEvent);
    return () => {
      eventDispatcher.off('handwriting', onHandwritingEvent);
    };
  }, [bookKey, setEnabled, reload]);

  if (!hw.available) return null;

  return (
    <>
      <HandwritingCanvas
        strokes={hw.strokes}
        cellRect={hw.cellRect}
        pageRect={hw.pageRect}
        interactive={hw.enabled}
        overlayRef={hw.containerRef}
        attach={hw.attach}
        detach={hw.detach}
      />
      {hw.enabled && (
        <div
          className='absolute inset-x-0 z-10 flex justify-center px-2'
          style={{ top: gridInsets.top + 8 }}
        >
          <HandwritingToolbar
            onExit={() => setEnabled(false)}
            erasing={hw.erasing}
            onToggleErase={() => hw.setErasing(!hw.erasing)}
            onUndo={hw.undo}
            onRedo={hw.redo}
            onClear={hw.clear}
            hasInk={hw.hasInk}
            penColor={hw.penColor}
            penWidth={hw.penWidth}
            onSelectColor={hw.selectPenColor}
            onSelectWidth={hw.selectPenWidth}
          />
        </div>
      )}
    </>
  );
};

export default HandwritingOverlay;
