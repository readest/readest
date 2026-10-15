import React, { useEffect } from 'react';

import { Insets } from '@/types/misc';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useHandwriting } from '../../hooks/useHandwriting';
import HandwritingCanvas from './HandwritingCanvas';
import { HandwritingDock } from './HandwritingBars';

interface HandwritingOverlayProps {
  bookKey: string;
  gridInsets: Insets;
}

/**
 * Ink layer for one open book. Always paints the page's ink; while drawing
 * (started from the header's pen button, or by tapping existing ink) it takes
 * pen input and swaps the reader's header and footer for its own bars.
 */
const HandwritingOverlay: React.FC<HandwritingOverlayProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const hw = useHandwriting(bookKey);
  const { visible, editable, enabled, setEnabled, setErasing, hitTest } = hw;
  const { setHoveredBookKey } = useReaderStore();

  // Drawing is started from the header's instant annotation tools, which
  // leaves the reader's header and footer up; the dock takes their place, and
  // the canvas takes the tap that would hide them. Each session starts with the pen: an eraser
  // left on last time would silently wipe ink instead of drawing.
  useEffect(() => {
    if (!enabled) return;
    setHoveredBookKey(null);
    setErasing(false);
  }, [enabled, setHoveredBookKey, setErasing]);

  useEffect(() => {
    const onHandwritingEvent = (event: CustomEvent) => {
      const { action, bookKey: target } = event.detail as { action: string; bookKey: string };
      if (target !== bookKey) return;
      if (action === 'toggle') setEnabled(!enabled);
    };
    eventDispatcher.on('handwriting', onHandwritingEvent);
    return () => {
      eventDispatcher.off('handwriting', onHandwritingEvent);
    };
  }, [bookKey, enabled, setEnabled]);

  // A tap on existing ink opens it for editing instead of turning the page.
  useEffect(() => {
    if (!editable || enabled) return;
    const onTap = (event: CustomEvent) => {
      const {
        bookKey: target,
        windowX,
        windowY,
      } = (event.detail ?? {}) as {
        bookKey?: string;
        windowX?: number;
        windowY?: number;
      };
      if (target !== bookKey || windowX === undefined || windowY === undefined) return false;
      if (!hitTest(windowX, windowY)) return false;
      setEnabled(true);
      return true;
    };
    eventDispatcher.onSync('iframe-single-click', onTap);
    return () => {
      eventDispatcher.offSync('iframe-single-click', onTap);
    };
  }, [bookKey, editable, enabled, hitTest, setEnabled]);

  if (!visible) return null;

  return (
    <>
      <HandwritingCanvas
        layers={hw.layers}
        cellRect={hw.cellRect}
        interactive={hw.enabled}
        overlayRef={hw.containerRef}
        attach={hw.attach}
        detach={hw.detach}
      />
      {hw.enabled && (
        <HandwritingDock
          bottomInset={gridInsets.bottom}
          erasing={hw.erasing}
          onToggleErase={() => hw.setErasing(!hw.erasing)}
          onUndo={hw.undo}
          onRedo={hw.redo}
          onTurnLeft={() => hw.turnPage('left')}
          onTurnRight={() => hw.turnPage('right')}
          penColor={hw.penColor}
          penWidth={hw.penWidth}
          onSelectColor={hw.selectPenColor}
          onSelectWidth={hw.selectPenWidth}
          onSave={() => {
            if (!hw.saveDrawing()) return;
            eventDispatcher.dispatch('toast', {
              type: 'info',
              timeout: 1500,
              message: _('Drawing saved'),
            });
          }}
          onClose={() => setEnabled(false)}
          tool={hw.tool}
          onSelectTool={hw.selectTool}
        />
      )}
    </>
  );
};

export default HandwritingOverlay;
