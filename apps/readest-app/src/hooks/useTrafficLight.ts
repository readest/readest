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
    // Position is declared on the window itself via Tauri's
    // `trafficLightPosition` (Rust `WebviewWindowBuilder` for the
    // main window in `src-tauri/src/lib.rs`; `new WebviewWindow(...)`
    // for reader windows in `utils/nav.ts`). This call only flips the
    // visibility flag — the buttons stay in their declared inset until
    // the reader explicitly hides them on a HeaderBar dwell.
    setTrafficLightVisibility(true);
    return () => {
      cleanupTrafficLightListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasTrafficLight]);

  return { isTrafficLightVisible };
};
