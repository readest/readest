import '@/i18n/i18n';
import { useTranslation as _useTranslation } from 'react-i18next';

export const useTranslation = (namespace: string = 'translation') => {
  const { t } = _useTranslation(namespace);

  return (key: string, options = {}) => t(key, { defaultValue: key, ...options });
};
