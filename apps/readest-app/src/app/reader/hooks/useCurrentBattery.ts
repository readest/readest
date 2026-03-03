import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { getBatteryInfo } from 'tauri-plugin-device-info-api';
import { isTauriAppPlatform } from '@/services/environment';

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}
export function useCurrentBatteryStatus(enabled: boolean) {
  const { appService } = useEnv();
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('getBattery' in navigator)) {
      return;
    }

    let battery: BatteryManager | null = null;

    const updateBatteryInfo = (batt: BatteryManager) => {
      const level = Math.round(batt.level * 100);
      setBatteryLevel(level);
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

  useEffect(() => {
    if (!enabled || !appService || !isTauriAppPlatform()) return;

    const fetchBatteryInfo = async () => {
      try {
        const info = await getBatteryInfo();
        if (info.level !== undefined) {
          setBatteryLevel(Math.round(info.level));
        }
      } catch (error) {
        console.error('Failed to fetch battery info:', error);
      }
    };
    fetchBatteryInfo();
    const interval = setInterval(fetchBatteryInfo, 60_000);
    return () => clearInterval(interval);
  }, [appService, enabled]);

  return batteryLevel;
}
