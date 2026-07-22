import clsx from 'clsx';
import { ChangeEvent, useMemo, useRef, useState } from 'react';

type TickRulerProps = {
  min: number;
  max: number;
  step: number;
  // Values getting a dim label and a taller tick.
  marks: number[];
  value: number;
  ariaLabel: string;
  // Bright label above the active tick.
  formatValue: (value: number) => string;
  // Dim labels above the marks.
  formatMark: (value: number) => string;
  onSelect: (value: number) => void;
};

// Generic tick-comb ruler (speed and pause controls share it): dim labeled
// marks, the current value spotlighted above the tallest active tick. An
// invisible native range input drives it so drag / tap / keyboard come for
// free; drags preview locally and the value only commits on release, since
// each commit persists settings and pokes the TTS engine.
const TickRuler = ({
  min,
  max,
  step,
  marks,
  value,
  ariaLabel,
  formatValue,
  formatMark,
  onSelect,
}: TickRulerProps) => {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const keyboardCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const range = max - min;
  const ticks = useMemo(
    () =>
      Array.from(
        { length: Math.round(range / step) + 1 },
        (_, i) => Math.round((min + i * step) * 100) / 100,
      ),
    [min, range, step],
  );

  const current = dragValue ?? value;
  const activeIndex = Math.min(ticks.length - 1, Math.max(0, Math.round((current - min) / step)));
  const toPct = (v: number) => ((Math.min(Math.max(v, min), max) - min) / range) * 100;
  // A mark hides when the bright value label would overlap it: within 8% of
  // the range, compared in step units so float error can't hide the mark one
  // step too early (2.0 - 1.8 is 0.1999...).
  const hideSteps = Math.round((range * 0.08) / step);
  const isMark = (tick: number) =>
    marks.some((m) => Math.round(m * 100) === Math.round(tick * 100));

  const commit = () => {
    const pending = dragValueRef.current;
    dragValueRef.current = null;
    setDragValue(null);
    if (pending !== null && pending !== value) onSelect(pending);
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
          {marks.map((mark) => (
            <span
              key={mark}
              className={clsx(
                'text-base-content/50 absolute top-0 -translate-x-1/2 text-xs tabular-nums',
                Math.round(Math.abs(mark - current) / step) < hideSteps && 'invisible',
              )}
              style={{ left: `${toPct(mark)}%` }}
            >
              {formatMark(mark)}
            </span>
          ))}
          <span
            className='text-base-content absolute top-0 -translate-x-1/2 text-xs font-semibold tabular-nums'
            style={{ left: `${toPct(current)}%` }}
          >
            {formatValue(current)}
          </span>
        </div>
        <div className='relative h-7'>
          {ticks.map((tick, i) => {
            const isActive = i === activeIndex;
            return (
              <div
                key={tick}
                className={clsx(
                  'absolute top-0 -translate-x-1/2 rounded-full',
                  isActive
                    ? 'bg-base-content h-7 w-0.5'
                    : isMark(tick)
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
          min={min}
          max={max}
          step={step}
          value={current}
          onChange={handleChange}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={handleKeyUp}
          aria-label={ariaLabel}
          aria-valuetext={formatValue(current)}
          className='absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0'
        />
      </div>
    </div>
  );
};

export default TickRuler;
