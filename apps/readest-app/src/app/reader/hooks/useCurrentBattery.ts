import { useEffect, useState } from 'react';

export function useCurrentBatteryStatus(enabled: boolean) {
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('getBattery' in navigator)) {
      return;
    }

    let battery: any = null;

    const updateBatteryInfo = (batt: any) => {
      const level = Math.round(batt.level * 100);
      setBatteryLevel(`${level}%`);
    };

    (navigator as any).getBattery().then((batt: any) => {
      battery = batt;
      updateBatteryInfo(batt);

      batt.addEventListener('levelchange', () => updateBatteryInfo(batt));
    });

    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', () => updateBatteryInfo(battery));
      }
    };
  }, [enabled]);

  return batteryLevel;
}
