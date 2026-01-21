import { useThemeStore } from '@/store/themeStore';
import { useCallback } from 'react';

export const useEinkMode = () => {
  const { setIsEinkMode } = useThemeStore();
  const applyEinkMode = useCallback(
    (isEink: boolean) => {
      setIsEinkMode(isEink);
      if (isEink) {
        document.body.classList.add('no-transitions');
      } else {
        document.body.classList.remove('no-transitions');
      }
      document.documentElement.setAttribute('data-eink', isEink.toString());
    },
    [setIsEinkMode],
  );

  return { applyEinkMode };
};
