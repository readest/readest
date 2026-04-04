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
}

const StatusInfo: React.FC<StatusInfoProps> = ({
  showTime,
  use24Hour = true,
  showBattery,
  showBatteryPercentage,
  isVertical,
  isEink,
}) => {
  const formattedTime = useCurrentTime(showTime, use24Hour);
  const batteryLevel = useCurrentBatteryStatus(showBattery);

  if (!showTime && !showBattery) return null;

  return (
    <div
      className={clsx(
        'status-bar flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums',
        isVertical ? 'my-auto' : 'flex-row',
      )}
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
              width={(batteryLevel / 100) * 21}
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
          {showBatteryPercentage && batteryLevel !== null && (
            <span
              className={clsx(
                'absolute text-[8px] font-medium leading-none invert',
                isVertical && '[writing-mode:horizontal-tb]',
                isEink ? 'text-black mix-blend-difference' : 'text-base-300 mix-blend-luminosity',
              )}
              style={{ left: '11px', transform: 'translateX(-50%)' }}
            >
              {batteryLevel}
            </span>
          )}
        </span>
      )}
    </div>
  );
};

export default StatusInfo;
