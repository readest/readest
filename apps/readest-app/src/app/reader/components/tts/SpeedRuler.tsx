import clsx from 'clsx';
import { ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3.0;
export const SPEED_STEP = 0.05;

const MAJOR_MARKS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
const TICKS = Array.from(
  { length: Math.round((SPEED_MAX - SPEED_MIN) / SPEED_STEP) + 1 },
  (_, i) => Math.round((SPEED_MIN + i * SPEED_STEP) * 100) / 100,
);

export const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

const toPct = (value: number) =>
  ((Math.min(Math.max(value, SPEED_MIN), SPEED_MAX) - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;

type SpeedRulerProps = {
  rate: number;
  onSelect: (rate: number) => void;
};

// Ruler-style speed slider (lives in the sheet's Speed sub-view): a tick comb
// from 0.5× to 3× in 0.05 steps, dim marks at each 0.5, and the current value
// spotlighted above its tick. An invisible native range input drives it so
// drag / tap / keyboard come for free; drags preview locally and the rate
// only commits on release, since each commit persists settings and pokes the
// TTS engine.
const SpeedRuler = ({ rate, onSelect }: SpeedRulerProps) => {
  const _ = useTranslation();
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const keyboardCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = dragValue ?? rate;
  const activeIndex = Math.min(
    TICKS.length - 1,
    Math.max(0, Math.round((value - SPEED_MIN) / SPEED_STEP)),
  );

  const commit = () => {
    const pending = dragValueRef.current;
    dragValueRef.current = null;
    setDragValue(null);
    if (pending !== null && pending !== rate) onSelect(pending);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // React fires range onChange continuously during a drag; track the value
    // and commit only on pointer/key release.
    const next = Math.round(parseFloat(e.target.value) * 100) / 100;
    dragValueRef.current = next;
    setDragValue(next);
  };

  const handleKeyUp = () => {
    // Holding an arrow key must not persist settings per press.
    if (keyboardCommitRef.current) clearTimeout(keyboardCommitRef.current);
    keyboardCommitRef.current = setTimeout(commit, 500);
  };

  return (
    <div dir='ltr' className='w-full px-4 py-2'>
      <div className='relative'>
        <div className='relative h-5'>
          {MAJOR_MARKS.map((mark) => (
            <span
              key={mark}
              className={clsx(
                'text-base-content/50 absolute top-0 -translate-x-1/2 text-xs tabular-nums',
                // Float-safe distance: 2.0 - 1.8 is 0.1999... and must not
                // count as "closer than 0.2", or the mark next to the value
                // label vanishes one step too early.
                Math.round(Math.abs(mark - value) * 100) < 20 && 'invisible',
              )}
              style={{ left: `${toPct(mark)}%` }}
            >
              {mark.toFixed(1)}
            </span>
          ))}
          <span
            className='text-base-content absolute top-0 -translate-x-1/2 text-xs font-semibold tabular-nums'
            style={{ left: `${toPct(value)}%` }}
          >
            {formatRate(value)}
          </span>
        </div>
        <div className='relative h-7'>
          {TICKS.map((tick, i) => {
            const isActive = i === activeIndex;
            const isMajor = Math.round(tick * 100) % 50 === 0;
            return (
              <div
                key={tick}
                className={clsx(
                  'absolute top-0 -translate-x-1/2 rounded-full',
                  isActive
                    ? 'bg-base-content h-7 w-0.5'
                    : isMajor
                      ? 'bg-base-content/40 h-5 w-0.5'
                      : 'bg-base-content/25 h-3.5 w-px',
                )}
                style={{ left: `${toPct(tick)}%` }}
              />
            );
          })}
        </div>
        <input
          type='range'
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={value}
          onChange={handleChange}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={handleKeyUp}
          aria-label={_('Speed')}
          aria-valuetext={formatRate(value)}
          className='absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0'
        />
      </div>
    </div>
  );
};

export default SpeedRuler;
