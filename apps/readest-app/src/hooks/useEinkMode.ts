import { useCallback } from 'react';

export const useEinkMode = () => {
  const applyEinkMode = useCallback((isEink: boolean) => {
    if (isEink) {
      document.body.classList.add('no-transitions');
    } else {
      document.body.classList.remove('no-transitions');
    }
    document.documentElement.setAttribute('data-eink', isEink.toString());
  }, []);

  return { applyEinkMode };
};
