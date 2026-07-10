import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { formatGap } from './GapChips';

export const PARAGRAPH_GAP_PRESETS = [0, 0.15, 0.3, 0.5, 0.75, 1, 1.5, 2];

type ParagraphGapChipsProps = {
  gap: number;
  onSelect: (gap: number) => void;
};

// Paragraph-pause presets as a wrapping chip grid (lives in the sheet's
// Paragraph Gap sub-view). A persisted off-preset gap merges in as a
// selectable chip in sorted position so the grid always shows the truth.
const ParagraphGapChips = ({ gap, onSelect }: ParagraphGapChipsProps) => {
  const _ = useTranslation();
  const values = PARAGRAPH_GAP_PRESETS.includes(gap)
    ? PARAGRAPH_GAP_PRESETS
    : [...PARAGRAPH_GAP_PRESETS, gap].sort((a, b) => a - b);

  return (
    <div
      role='radiogroup'
      aria-label={_('Paragraph Gap')}
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

export default ParagraphGapChips;
