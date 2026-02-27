import { useEffect, useState, useMemo } from 'react';

export function useCurrentTime(enabled: boolean, intervalMs = 20000) {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs]);

  return useMemo(() => {
    if (!enabled) return '';

    return currentTime.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [currentTime, enabled]);
}
