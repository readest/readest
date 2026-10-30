import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { ViewSettings } from '@/types/book';
import { DuoPose, getDuoPose, getRendererLayout, RendererLayout } from '@/utils/duo';
import { getReadingScreenInsets } from '@/utils/insets';

const readPose = (isIPhoneDuo: boolean): DuoPose =>
  getDuoPose(isIPhoneDuo, window.innerWidth, window.innerHeight);

/**
 * The width the page lays out in: the viewport inside the side insets the
 * reading page keeps (see getReadingScreenInsets), so showing the toolbar and
 * its status strip does not change the layout.
 */
const readPageWidth = () => {
  const { safeAreaInsets, statusBarHiddenInsets, isIPhoneDuo } = useThemeStore.getState();
  const { alwaysShowStatusBar } = useSettingsStore.getState().settings;
  const insets =
    safeAreaInsets &&
    getReadingScreenInsets(
      safeAreaInsets,
      isIPhoneDuo && !alwaysShowStatusBar ? statusBarHiddenInsets : null,
      window.innerWidth,
      window.innerHeight,
    );
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
