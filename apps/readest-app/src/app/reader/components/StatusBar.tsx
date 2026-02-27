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

const StatusBar: React.FC<StatusBarProps> = ({ showTime, use24Hour = true, showBattery, isVertical }) => {
  const formattedTime = useCurrentTime(showTime, use24Hour);
  const batteryStatus = useCurrentBatteryStatus(showBattery);

  if (!showTime && !showBattery) return null;

  return (
    <div className={clsx(
      'flex items-center gap-3 shrink-0 px-2 tabular-nums whitespace-nowrap',
      isVertical ? 'flex-col my-auto' : 'flex-row'
    )}>
      {showTime && <span>{formattedTime}</span>}
      {showBattery && batteryStatus && <span>{batteryStatus}</span>}
    </div>
  );
};

export default StatusBar;
