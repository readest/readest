import { useEffect, useState } from 'react';
import { formatCountdown } from '@/utils/time';

// Live M:SS label for an armed sleep timer; empty string when no timer.
export const useCountdownLabel = (timeoutTimestamp: number) => {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!timeoutTimestamp) {
      setLabel('');
      return;
    }
    const tick = () =>
      setLabel(timeoutTimestamp > Date.now() ? formatCountdown(timeoutTimestamp - Date.now()) : '');
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timeoutTimestamp]);
  return label;
};
