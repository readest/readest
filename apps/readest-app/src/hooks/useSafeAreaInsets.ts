import { useState, useEffect, useCallback } from 'react';

export const useSafeAreaInsets = () => {
  const [updated, setUpdated] = useState(false);
  const [insets, setInsets] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });

  const updateSafeAreaInsets = useCallback(() => {
    const rootStyles = getComputedStyle(document.documentElement);
    const hasCustomProperties = rootStyles.getPropertyValue('--safe-area-inset-top');
    if (hasCustomProperties) {
      setInsets({
        top: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-top')) || 0,
        right: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-right')) || 0,
        bottom: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-bottom')) || 0,
        left: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-left')) || 0,
      });
    }
    setUpdated(true);
  }, []);

  useEffect(() => {
    updateSafeAreaInsets();
    window.addEventListener('resize', updateSafeAreaInsets);
    return () => {
      window.removeEventListener('resize', updateSafeAreaInsets);
    };
  }, [updateSafeAreaInsets]);

  return updated ? insets : null;
};
