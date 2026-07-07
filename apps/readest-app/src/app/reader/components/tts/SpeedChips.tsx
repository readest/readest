import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export const SPEED_PRESETS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

type SpeedChipsProps = {
  rate: number;
  onSelect: (rate: number) => void;
};

// Playback-speed presets as a scrollable chip row (the modern listening-app
// convention). A persisted off-preset rate (e.g. 1.3 from the old slider or
// the default config) merges in as a selectable chip in sorted position so
// the row always shows the truth.
const SpeedChips = ({ rate, onSelect }: SpeedChipsProps) => {
  const _ = useTranslation();
  const activeRef = useRef<HTMLButtonElement>(null);
  const values = SPEED_PRESETS.includes(rate)
    ? SPEED_PRESETS
    : [...SPEED_PRESETS, rate].sort((a, b) => a - b);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [rate]);

  return (
    <div
      role='radiogroup'
      aria-label={_('Speed')}
      className='flex w-full gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    >
      {values.map((value) => {
        const active = value === rate;
        return (
          <button
            key={value}
            ref={active ? activeRef : undefined}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => onSelect(value)}
            className={clsx(
              'btn btn-sm h-8 min-h-8 shrink-0 rounded-full border-none px-3 font-normal shadow-none',
              active ? 'btn-primary' : 'bg-base-100 eink-bordered',
            )}
          >
            {formatRate(value)}
          </button>
        );
      })}
    </div>
  );
};

export default SpeedChips;
