import React from 'react';
import clsx from 'clsx';
import { useCurrentTime } from '../hooks/useCurrentTime';
import { useCurrentBatteryStatus } from '../hooks/useCurrentBattery';

interface StatusBarProps {
  showTime: boolean;
  showBattery: boolean;
  use24Hour?: boolean;
  isVertical?: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({
  showTime,
  use24Hour = true,
  showBattery,
  isVertical,
}) => {
  const formattedTime = useCurrentTime(showTime, use24Hour);
  const batteryStatus = useCurrentBatteryStatus(showBattery);

  if (!showTime && !showBattery) return null;

  return (
    <div
      className={clsx(
        'flex shrink-0 items-center gap-3 whitespace-nowrap px-2 tabular-nums',
        isVertical ? 'my-auto flex-col' : 'flex-row',
      )}
    >
      {showTime && <span>{formattedTime}</span>}
      {showBattery && batteryStatus && <span>{batteryStatus}</span>}
    </div>
  );
};

export default StatusBar;
