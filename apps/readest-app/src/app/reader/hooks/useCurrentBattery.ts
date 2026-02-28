import { useEffect, useState } from 'react';

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}
export function useCurrentBatteryStatus(enabled: boolean) {
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('getBattery' in navigator)) {
      return;
    }

    let battery: BatteryManager | null = null;

    const updateBatteryInfo = (batt: BatteryManager) => {
      const level = Math.round(batt.level * 100);
      setBatteryLevel(`${level}%`);
    };

    const handleLevelChange = (event: Event) => {
      updateBatteryInfo(event.currentTarget as BatteryManager);
    };

    (navigator as unknown as { getBattery: () => Promise<BatteryManager> })
      .getBattery()
      .then((batt) => {
        battery = batt;
        updateBatteryInfo(batt);
        batt.addEventListener('levelchange', handleLevelChange);
      });

    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', handleLevelChange);
      }
    };
  }, [enabled]);

  return batteryLevel;
}
