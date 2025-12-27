import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTrafficLightStore } from '@/store/trafficLightStore';

export const useTrafficLight = () => {
  const { appService } = useEnv();

  const {
    isTrafficLightVisible,
    initializeTrafficLightStore,
    initializeTrafficLightListeners,
    setTrafficLightVisibility,
    cleanupTrafficLightListeners,
  } = useTrafficLightStore();

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    initializeTrafficLightStore(appService);
    initializeTrafficLightListeners();
    setTrafficLightVisibility(true);
    return () => {
      cleanupTrafficLightListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasTrafficLight]);

  return { isTrafficLightVisible };
};
