import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { Insets } from '@/types/misc';
import { AUTO_TURN_DWELL_MS, TurnHint, getReadingAreaRect } from '../../hooks/useAutoPageTurn';

interface PageTurnHintProps {
  bookKey: string;
  contentInsets: Insets;
  hint: TurnHint | null;
}

// Marks the page edge a selection drag has armed, and runs a bar along it for
// the length of the dwell, so holding there reads as "keep holding to turn"
// rather than as nothing happening. Nothing else advertises the gesture.
const PageTurnHint: React.FC<PageTurnHintProps> = ({ bookKey, contentInsets, hint }) => {
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    if (!hint) {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [hint]);

  if (!hint) return null;
  const area = getReadingAreaRect(bookKey, contentInsets);
  if (!area) return null;

  // E-ink refreshes too slowly to run the bar out, and a translucent one barely
  // renders, so there the armed edge is simply drawn solid.
  const isEink = document.documentElement.getAttribute('data-eink') === 'true';
  const forward = hint.corner === 'br';
  const filled = isEink || hint.turned || grown;
  // Physical sides on purpose: the corners come from screen coordinates
  // (cornerOf), so a logical `end-0` would put the bar on the wrong edge in RTL.
  const style = (horizontal: boolean): React.CSSProperties => ({
    opacity: isEink ? 1 : hint.turned ? 0.75 : 0.35,
    transform: `scale${horizontal ? 'X' : 'Y'}(${filled ? 1 : 0})`,
    transformOrigin: forward ? (horizontal ? 'right' : 'bottom') : horizontal ? 'left' : 'top',
    transitionProperty: 'transform',
    transitionTimingFunction: 'linear',
    transitionDuration: `${hint.turned ? 120 : AUTO_TURN_DWELL_MS}ms`,
  });

  return (
    <div
      className='pointer-events-none fixed z-50'
      style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
      aria-hidden='true'
    >
      <div
        className={clsx(
          'bg-base-content absolute inset-y-0 rounded-full',
          forward ? 'right-0' : 'left-0',
        )}
        style={{ width: 3, ...style(false) }}
      />
      <div
        className={clsx(
          'bg-base-content absolute inset-x-0 rounded-full',
          forward ? 'bottom-0' : 'top-0',
        )}
        style={{ height: 3, ...style(true) }}
      />
    </div>
  );
};

export default PageTurnHint;
