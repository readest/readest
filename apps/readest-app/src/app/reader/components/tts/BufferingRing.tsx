import clsx from 'clsx';

type BufferingRingProps = {
  // Diameter in px. Pick it so the ring clears the glyph it wraps rather than
  // covering it; it inherits currentColor from the button it sits in.
  size: number;
  isEink: boolean;
};

// Indeterminate ring for a transport button whose engine has taken an utterance
// but has no audio out yet. A ring rather than a swapped icon: the reader must
// still be able to pause while a sentence is being fetched, so the play/pause
// glyph stays where it is and stays pressable.
const BufferingRing = ({ size, isEink }: BufferingRingProps) => {
  const stroke = Math.max(2, Math.round(size / 16));
  const radius = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      className={clsx(
        'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        // E-ink cannot animate: a spinning ring there is a refresh storm for no
        // information. The gap in the track reads as "waiting" while static.
        !isEink && 'animate-spin',
      )}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        strokeWidth={stroke}
        className='stroke-current opacity-25'
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        strokeWidth={stroke}
        strokeLinecap='round'
        strokeDasharray={`${circumference * 0.25} ${circumference}`}
        className='stroke-current'
      />
    </svg>
  );
};

export default BufferingRing;
