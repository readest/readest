import React from 'react';
import clsx from 'clsx';
import { useCurrentTime } from '../hooks/useCurrentTime';
import { useCurrentBatteryStatus } from '../hooks/useCurrentBattery';

interface StatusInfoProps {
  showTime: boolean;
  showBattery: boolean;
  showBatteryPercentage: boolean;
  use24Hour?: boolean;
  isVertical?: boolean;
  isEink?: boolean;
  className?: string;
  /** Backdrop for the scrolled-mode pill; see ProgressBar. */
  style?: React.CSSProperties;
}

const StatusInfo: React.FC<StatusInfoProps> = ({
  showTime,
  use24Hour = true,
  showBattery,
  showBatteryPercentage,
  isVertical,
  isEink,
  className,
  style,
}) => {
  const formattedTime = useCurrentTime(showTime, use24Hour);
  const batteryLevel = useCurrentBatteryStatus(showBattery);

  if (!showTime && !showBattery) return null;

  const fillWidth = ((batteryLevel ?? 0) / 100) * 21;
  // The fill rect starts at x=0.5 of the 25px-wide icon.
  const fillClipRight = (25 - 0.5 - fillWidth).toFixed(2);
  const renderPercentage = (colorClass: string) => (
    <span
      className={clsx(
        'battery-percentage absolute text-[8px] font-medium leading-none',
        colorClass,
        isVertical && '[writing-mode:horizontal-tb]',
      )}
      style={{ left: '11px', transform: 'translateX(-50%)' }}
    >
      {batteryLevel}
    </span>
  );

  return (
    <div
      className={clsx(
        'status-bar flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums',
        isVertical ? 'my-auto' : 'flex-row',
        className,
      )}
      style={style}
    >
      {showTime && <span>{formattedTime}</span>}
      {showBattery && batteryLevel !== null && (
        <span
          className={clsx(
            'relative inline-flex items-center justify-center',
            isVertical ? 'my-[6.5px] rotate-90' : 'translate-y-[-0.5px]',
          )}
        >
          <svg width='25' height='12' viewBox='0 0 25 12' fill='none'>
            <rect
              x='0.5'
              y='0.5'
              width='21'
              height='11'
              rx='2'
              stroke='currentColor'
              strokeWidth='1'
              opacity={isEink ? 1.0 : 0.75}
            />
            <rect
              x='0.5'
              y='0.5'
              width={fillWidth}
              height='11'
              rx='1'
              fill='currentColor'
              opacity={isEink ? 1.0 : 0.3}
            />
            <path
              d='M23 4V8C23.8 8 24 7 24 6C24 5 23.8 4 23 4Z'
              fill='currentColor'
              opacity={isEink ? 1.0 : 0.75}
            />
          </svg>
          {/* The fill behind the number is currentColor at 30% opacity -- a
              mid tone in any theme, which themed text reads against. In eink
              the fill is opaque base-content but covers only the charged part,
              so a page-colored copy clipped to the fill is knocked out of it
              while the rest of the number stays base-content. */}
          {showBatteryPercentage && renderPercentage('text-base-content')}
          {showBatteryPercentage && isEink && (
            <span
              className='absolute inset-0 flex items-center justify-center'
              style={{ clipPath: `inset(0px ${fillClipRight}px 0px 0px)` }}
            >
              {renderPercentage('text-base-100')}
            </span>
          )}
        </span>
      )}
    </div>
  );
};

export default StatusInfo;
