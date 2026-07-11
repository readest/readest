import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';

export const GAP_PRESETS = [0, 0.1, 0.15, 0.25, 0.4, 0.6];

export const formatGap = (sec: number) => `${parseFloat(sec.toFixed(2))}s`;

type GapChipsProps = {
  gap: number;
  onSelect: (gap: number) => void;
};

// Inter-sentence pause presets as a wrapping chip grid (lives in the sheet's
// Sentence Pause sub-view). A persisted off-preset gap (e.g. from a future
// non-chip input or an older config) merges in as a selectable chip in
// sorted position so the grid always shows the truth.
const GapChips = ({ gap, onSelect }: GapChipsProps) => {
  const _ = useTranslation();
  const values = GAP_PRESETS.includes(gap)
    ? GAP_PRESETS
    : [...GAP_PRESETS, gap].sort((a, b) => a - b);

  return (
    <div
      role='radiogroup'
      aria-label={_('Sentence Pause')}
      className='flex w-full flex-wrap justify-center gap-2 px-1 py-1'
    >
      {values.map((value) => {
        const active = value === gap;
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
            {formatGap(value)}
          </button>
        );
      })}
    </div>
  );
};

export default GapChips;
