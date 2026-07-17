import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';

export const SPEED_PRESETS = [0.5, 0.75, 0.8, 0.85, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

export const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

type SpeedChipsProps = {
  rate: number;
  onSelect: (rate: number) => void;
};

// Playback-speed presets as a wrapping chip grid (lives in the sheet's Speed
// sub-view). A persisted off-preset rate (e.g. 1.3 from the old slider or
// the default config) merges in as a selectable chip in sorted position so
// the grid always shows the truth.
const SpeedChips = ({ rate, onSelect }: SpeedChipsProps) => {
  const _ = useTranslation();
  const values = SPEED_PRESETS.includes(rate)
    ? SPEED_PRESETS
    : [...SPEED_PRESETS, rate].sort((a, b) => a - b);

  return (
    <div
      role='radiogroup'
      aria-label={_('Speed')}
      className='flex w-full flex-wrap justify-center gap-2 px-1 py-1'
    >
      {values.map((value) => {
        const active = value === rate;
        return (
          <button
            key={value}
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
