import { useEffect, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { ViewSettings } from '@/types/book';
import { DuoPose, getDuoPose, getRendererLayout, RendererLayout } from '@/utils/duo';

const readPose = (isIPhoneDuo: boolean): DuoPose =>
  getDuoPose(isIPhoneDuo, window.innerWidth, window.innerHeight);

/** The width the page lays out in: the viewport inside the side insets. */
const readPageWidth = () => {
  const insets = useThemeStore.getState().safeAreaInsets;
  return window.innerWidth - (insets?.left ?? 0) - (insets?.right ?? 0);
};

/**
 * The renderer layout for the current iPhone Duo pose, read at call time for
 * imperative callers. Off the Duo it is the reader's own settings.
 */
export const getCurrentRendererLayout = (viewSettings: ViewSettings): RendererLayout => {
  const { isIPhoneDuo, duoFold } = useThemeStore.getState();
  return getRendererLayout(viewSettings, readPose(isIPhoneDuo), readPageWidth(), duoFold);
};

/**
 * The current iPhone Duo pose, kept up to date as the device folds, unfolds
 * or turns. Always `off` on other devices, which never subscribe to resize.
 */
export const useDuoPose = (): DuoPose => {
  const isIPhoneDuo = useThemeStore((s) => s.isIPhoneDuo);
  const [pose, setPose] = useState<DuoPose>(() => readPose(isIPhoneDuo));

  useEffect(() => {
    setPose(readPose(isIPhoneDuo));
    if (!isIPhoneDuo) return;
    const handleResize = () => setPose(readPose(true));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isIPhoneDuo]);

  return pose;
};
